## OpenResty Gateway & WebDAV


### CA 和 TLS 证书

#### Root CA 创建

_并不是要你自己搭建一个 CA 中心，这里的 CA 其实指的是创建自己的 CA 根证书，这样可以给后续步骤签署证书_

1. 创建 Root CA 密钥

   准备: 创建文件夹

   ```shell
   cd homelab-gateway
   mkdir build/ca
   mkdir build/ca/private
   mkdir build/ca/certs
   ```

   使用 RSA 算法

   ```shell
   openssl genrsa -out build/ca/private/CA.key.pem 4096
   ```

   或使用 椭圆曲线算法

   ```shell
   openssl ecparam -genkey -name secp256k1 -out build/ca/private/CA.key.pem
   ```

   __该密钥需要谨慎保存, 上传时务必检查其被排除, 并做好备份__

2. 生成 CA 自签名证书

   创建证书申请文件 & 自签

   ```shell
   openssl req -new -x509 -days 3650 -key build/ca/private/CA.key.pem -out build/ca/certs/HomeLabCA.crt
   ```

   信息
   ```shell
   You are about to be asked to enter information that will be incorporated
   into your certificate request.
   What you are about to enter is what is called a Distinguished Name or a DN.
   There are quite a few fields but you can leave some blank
   For some fields there will be a default value,
   If you enter '.', the field will be left blank.
   -----
   Country Name (2 letter code) [AU]:CN
   State or Province Name (full name) [Some-State]:Shanghai
   Locality Name (eg, city) []:Shanghai
   Organization Name (eg, company) [Internet Widgits Pty Ltd]:Ank Tech
   Organizational Unit Name (eg, section) []:Ank Tech
   Common Name (e.g. server FQDN or YOUR name) []:Carota's HomeLab
   Email Address []:
   ```

3. 生成自签 SSL 证书

   预定有效日期 1年 (375天) 因此文件名后的日期按实际情况修改

   (1) 准备文件夹

      ```shell
      cd homelab-gateway
      mkdir build/ssl
      mkdir build/ssl/private
      mkdir build/ssl/certs
      mkdir build/csr
      ```

   (2) 生成服务器密钥

      使用 RSA 算法

      ```shell
      openssl genrsa -out build/ssl/private/homelab-server.20250104.key.pem 4096
      ```

      或使用 椭圆曲线算法

      ```shell
      openssl ecparam -genkey -name secp256k1 -out build/ssl/private/homelab-server.20250104.key.pem
      ```

      __该密钥需要谨慎保存, 上传时务必检查其被排除, 并做好备份__

   (3) 创建服务器SSL证书生成请求

      ```shell
      openssl req -new -key build/ssl/private/homelab-server.20250104.key.pem -out build/ssl/private/homelab-server.20250104.csr
      ```

      信息

      ```
      You are about to be asked to enter information that will be incorporated
      into your certificate request.
      What you are about to enter is what is called a Distinguished Name or a DN.
      There are quite a few fields but you can leave some blank
      For some fields there will be a default value,
      If you enter '.', the field will be left blank.
      -----
      Country Name (2 letter code) [AU]:CN
      State or Province Name (full name) [Some-State]:Shanghai
      Locality Name (eg, city) []:Shanghai
      Organization Name (eg, company) [Internet Widgits Pty Ltd]:Ank Tech
      Organizational Unit Name (eg, section) []:Ank Tech
      Common Name (e.g. server FQDN or YOUR name) []:Carota's HomeLab Gateway
      Email Address []:

      Please enter the following 'extra' attributes
      to be sent with your certificate request
      A challenge password []:
      An optional company name []:
      ```

   (4) 创建证书拓展文件 `build/ssl/homelab-server.ext`

      ```
      authorityKeyIdentifier=keyid,issuer
      basicConstraints=CA:FALSE
      keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
      subjectAltName = @alt_names

      [alt_names]
      DNS.1 = *.rockpi.homelab
      DNS.2 = rockpi.homelab

      ```

   (5) 使用根证书颁发机构对证书进行签发 
      
      ```shell
      openssl x509 -req -in build/ssl/private/homelab-server.20250104.csr -CA build/ca/certs/HomeLabCA.crt -CAkey build/ca/private/CA.key.pem -CAcreateserial -out build/ssl/certs/homelab-server.20250104.crt -days 375 -sha256 -extfile build/ssl/homelab-server.ext

      ```

      此时可以验证证书

      ```shell
      openssl verify -CAfile build/ca/certs/HomeLabCA.crt build/ssl/certs/homelab-server.20250104.crt
      ```

   (6) 部署

      ```shell
      sudo mkdir /usr/local/openresty/nginx/ssl
      sudo cp build/ssl/certs/homelab-server.20250104.crt /usr/local/openresty/nginx/ssl/server.crt
      sudo cp build/ssl/private/homelab-server.20250104.key.pem /usr/local/openresty/nginx/ssl/server.key

      ```

### 安装

编译安装

#### 步骤

1. 安装 C/C++ 编译环境

2. 安装 编译依赖

   ```
   sudo apt update
   
   sudo apt install libxslt-dev
   ```

   libpcre: https://sourceforge.net/projects/pcre/files/pcre/
   libssl: https://github.com/openssl/openssl/releases

   libzlib: https://www.zlib.net/

3. 下载 OpenResty 源码

   https://openresty.org/en/download.html#lastest-release

   `tar zxvf` 解压到 `workspace`

4. 下载 nginx-dav-ext-module 源码

   https://github.com/arut/nginx-dav-ext-module/releases

   `tar zxvf` 解压到 `workspace`

----

### 以上下载源码(不包括安装 libxslt-dev 依赖) 可以使用

```shell
python3 -m tools.sourcekits
```

----

5. 配置编译指令

   `cd` 到 OpenResty 源码库 下

   `../nginx-dav-ext-module-<VERSION>` 替换成 对应 nginx-dav-ext-module 解压根目录 

   ```bash
   #!/bin/bash
   
   ./configure \
   --error-log-path=/var/log/openresty/error.log \
   --http-log-path=/var/log/openresty/access.log \
   --pid-path=/var/run/openresty.pid \
   --lock-path=/var/run/openresty.lock \
   --user=nginx \
   --group=nginx \
   --with-compat \
   --with-file-aio \
   --with-threads \
   --with-http_addition_module \
   --with-http_auth_request_module \
   --with-http_dav_module \
   --add-dynamic-module=../nginx-dav-ext-module-3.0.0 \
   --with-http_gunzip_module \
   --with-http_gzip_static_module \
   --with-http_random_index_module \
   --with-http_realip_module \
   --with-http_secure_link_module \
   --with-http_slice_module \
   --with-http_ssl_module \
   --with-http_stub_status_module \
   --with-http_sub_module \
   --with-http_v2_module \
   --with-http_v3_module \
   --with-http_xslt_module \
   --with-stream \
   --with-stream_realip_module \
   --with-stream_ssl_module \
   --with-stream_ssl_preread_module \
   --without-http_fastcgi_module \
   --without-http_uwsgi_module \
   --without-http_scgi_module \
   --without-pcre2 \
   --with-pcre-jit \
   --with-pcre=../pcre-8.45 \
   --with-zlib=../zlib-1.3.1 \
   --with-openssl=../openssl-3.3.0 \
   -j2
   ```
----

### 以上 配置编译选项可以使用

```shell
python3 -m tools.template
```

----


6. 编译

   `make`  (`-jN`)

   `sudo make install`

7. 用户配置 & 权限配置

   ```bash
   #sudo groupadd --system nginx

   # list all users
   cat /etc/passwd
   
   sudo useradd --system --no-create-home --home /nonexistent --comment "nginx user" --shell /usr/sbin/nologin nginx
   
   # list all groups for nginx
   groups nginx

   ```

   webdav 文件夹需要满足 `nginx` 用户权限需求

   Tips

   >
   >```bash
   >addgroup --system
   >[--gid id]
   >    [--conf file] [--quiet] [--verbose] [--debug]
   >    group
   >Add a system group
   >
   >adduser USER GROUP
   >Add an existing user to an existing group
   >
   >sudo usermod -a -G groupname username
   >```

   

8. webdav 密码配置

   安装 htpasswd 工具

   ```bash
   sudo apt install apache2-utils
   ```

   添加需要使用的 账号和密码

   ```bash
   cd /usr/local/openresty/nginx/conf/			# nginx configuration prefix
   
   sudo htpasswd -B -c webdav.htpasswd <username>		# 首次 (webdav.htpasswd 不存在)
   > New password: 
   > Re-type new password:
   
   sudo htpasswd -B webdav.htpasswd <username>			# 后续追加
   > New password: 
   > Re-type new password:
   ```

   test 账号: `testtest:testtest01`
   

9. ~~安装 Lua 包管理器~~

   > ~~First of all, let's install LuaRocks:~~
   >
   > ~~Download the LuaRocks tarball from https://luarocks.org/releases.~~ 
   >
   > ```shell
   > wget http://luarocks.org/releases/luarocks-2.0.13.tar.gz
   > tar -xzvf luarocks-2.0.13.tar.gz
   > cd luarocks-2.0.13/
   > ./configure --prefix=/usr/local/openresty/luajit \
   >     --with-lua=/usr/local/openresty/luajit/ \
   >     --lua-suffix=jit \
   >     --with-lua-include=/usr/local/openresty/luajit/include/luajit-2.1
   > make
   > sudo make install
   > ```

   使用 [OPM](https://github.com/openresty/opm#readme) 装lua包

   ```bash
   sudo apt install libcidr-dev
   
   sudo /usr/local/openresty/bin/opm get GUI/lua-libcidr-ffi
   ```

10. 配置

    复制 `conf/*.conf` 到 `/usr/local/openresty/nginx/conf`

    - `nginx.conf`
      - user 和 webdav user 密切相关
    - `webdav.loc.conf`
      -  `location /dav/` 的 `alias ... ` 修改成实际数据根目录 
      -  `location /dav/exchange` 的 `alias ... ` 修改成实际可变数据根目录 
      -  密码文件位于 `/usr/local/openresty/nginx/conf` 与实际相符
    - `vpnctrl.loc.conf`
      - 独立密码管控
      - 端口与实际端口匹配
    - `qbittorrent.loc.conf`
      - 密码文件位于 `/usr/local/openresty/nginx/conf` 与实际相符；qbittorrent-nox 对 localhost 不设密码
      - 端口与实际端口匹配
    - `status.loc.conf`
      - 密码文件位于 `/usr/local/openresty/nginx/conf` 与实际相符

    复制 `lua/*.lua` 到 `/usr/local/openresty/nginx/lua`

    - `nginx.conf` 标记 lua 库的搜索路径

      ```nginx
      http {
          lua_package_path "$prefix/lua/?.lua;;";
          
          ...
      }
      ```

      

11. 服务

    复制 `openresty.service` 到 `/usr/local/lib/systemd/system`

    之后

    ```bash
    sudo systemctl enable openresty.service
    ```

----

### 以上 部署 可以使用

```shell
python3 -m tools.deploykits

```

----

#### 安装统计

##### 安装位置

```
nginx path prefix: "/usr/local/openresty/nginx"
nginx binary file: "/usr/local/openresty/nginx/sbin/nginx"
nginx modules path: "/usr/local/openresty/nginx/modules"
nginx configuration prefix: "/usr/local/openresty/nginx/conf"
nginx configuration file: "/usr/local/openresty/nginx/conf/nginx.conf"
nginx pid file: "/var/run/openresty/nginx.pid"
nginx error log file: "/var/log/openresty/error.log"
nginx http access log file: "/var/log/openresty/access.log"
nginx http client request body temporary files: "client_body_temp"
nginx http proxy temporary files: "proxy_temp"
```

##### 包

```
sudo apt install libxslt-dev	56.1 MB
sudo apt install libcidr-dev	78.8 kB
sudo apt install apache2-utils	1,028 kB
```
