## OpenResty Gateway & WebDAV

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

6. 编译

   `make`  (`-jN`)

   `sudo make install`

7. 用户配置 & 权限配置

   ```bash
   #sudo groupadd --system nginx
   
   sudo useradd --system --no-create-home --home /nonexistent --comment "nginx user" --shell /usr/sbin/nologin nginx
   
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

    

12. -

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
