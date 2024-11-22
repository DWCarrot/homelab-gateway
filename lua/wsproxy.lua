local CFGDATA = require "CFGDATA"
local ngx = require "ngx"
local WebsocketServer = require "resty.websocket.server"
local InetAddress = require "inetaddr"
local IPFilter = require "ipfilter"

local WSProxy = { version = "0.1" }
local mt = { __index = WSProxy }

local _CONNECT_TYPE_MAP = {
    ["tcp"] = InetAddress.SOCKET_TCP,
    ["tls"] = InetAddress.SOCKET_TLS,
}

function WSProxy.check(ty)
    return _CONNECT_TYPE_MAP[ty] ~= nil
end

function WSProxy.new(ws_prefer_binary)
    local instance = {
        ws_prefer_binary = ws_prefer_binary,
        ws_timeout = CFGDATA.wsproxy.ws_timeout,
        ws_max_payload_len = CFGDATA.wsproxy.ws_max_payload_len,
        rs_timeout = CFGDATA.wsproxy.rs_timeout,
        rs_recv_buf_size = CFGDATA.wsproxy.rs_recv_buf_size,
        _ws = nil,
        _rs = nil,
        _running = false,
        _ws_closed = true,
        _rs_closed = true,
        _co = nil,
        _do_sock_recv_err = nil,
        _do_sock_recv_code = nil,
    }
    return setmetatable(instance, mt)
end

local function do_sock_recv(self)
    self._rs:settimeout(self.rs_timeout)
    while self._running do
        local data, err, partial = self._rs:receive(self.rs_recv_buf_size)
        if not data then
            if string.find(err, "timeout", 1, true) then
                if partial == nil or partial == '' then
                    ngx.log(ngx.DEBUG, "[WSProxy::_do_sock_recv] self._rs:receive timeout")
                else
                    ngx.log(ngx.DEBUG, "[WSProxy::_do_sock_recv] self._rs:receive received partial data of ", #partial)
                    local bytes = nil
                    if self.ws_prefer_binary then
                        bytes, err = self._ws:send_binary(partial)
                    else
                        bytes, err = self._ws:send_text(partial)
                    end
                    if not bytes then
                        self._do_sock_recv_code = 4001
                        self._do_sock_recv_err = err
                        ngx.log(ngx.ERR, "[WSProxy::_do_sock_recv] self._ws:send ", err)
                        break
                    end
                end
            elseif string.find(err, "closed", 1, true) then
                self._do_sock_recv_code = 1000
                self._do_sock_recv_err = 'remote closed'
                ngx.log(ngx.INFO, "[WSProxy::_do_sock_recv] self._rs:receive closed")
                self._rs_closed = true
                break
            else
                self._do_sock_recv_code = 4001
                self._do_sock_recv_err = err
                ngx.log(ngx.ERR, "[WSProxy::_do_sock_recv] self._rs:receive ", err)
                break
            end
        else
            ngx.log(ngx.DEBUG, "[WSProxy::_do_sock_recv] self._rs:receive received data of ", #data)
            local bytes = nil
            if self.ws_prefer_binary then
                bytes, err = self._ws:send_binary(data)
            else
                bytes, err = self._ws:send_text(data)
            end
            if not bytes then
                self._do_sock_recv_code = 4001
                self._do_sock_recv_err = err
                ngx.log(ngx.ERR, "[WSProxy::_do_sock_recv] self._ws:send ", err)
                break
            end
        end
    end
    self._running = false
end

local function proxy_inner(self, socket_type, host, port, mode, server_name)
    local ty = _CONNECT_TYPE_MAP[socket_type]
    if not ty then
        self._do_sock_recv_code = 4000
        self._do_sock_recv_err = "unknown socket type"
        return
    end

    local err = nil
    self._ws, err = WebsocketServer:new {
        timeout = self.ws_timeout,
        max_payload_len = self.ws_max_payload_len,
    }
    if not self._ws then
        return
    end
    self._ws_closed = false

    local ip
    self._rs, err, ip = host:create_socket(ty, port, mode, server_name)
    if not self._rs then
        self._do_sock_recv_code = 4000
        self._do_sock_recv_err = err
        return ngx.HTTP_INTERNAL_SERVER, err
    end
    self._rs_closed = false
    ngx.log(ngx.INFO, "[WSProxy::_proxy] connected to ", socket_type, "://", ip, ":", port)

    self._running = true
    self._co = ngx.thread.spawn(do_sock_recv, self)
    
    local data = nil
    local typ = nil
    while self._running do
        data, typ, err = self._ws:recv_frame()
        if not data then
            if string.find(err, "timeout", 1, true) then
                ngx.log(ngx.DEBUG, "[WSProxy::proxy] self._ws:recv_frame timeout ", err)
            else
                ngx.log(ngx.ERR, "[WSProxy::proxy] self._ws:recv_frame ", err)
                self._do_sock_recv_code = 4002
                self._do_sock_recv_err = err
                break
            end
        elseif typ == "close" then
            ngx.log(ngx.DEBUG, "[WSProxy::proxy] self._ws:recv_frame received close ", data)
            -- local bytes = nil
            -- bytes, err = self._ws:send_close()
            -- if not bytes then
            --     ngx.log(ngx.ERR, "[WSProxy::proxy] self._ws:send_close ", err)
            --     break
            -- end
            self._ws_closed = true
            ngx.log(ngx.INFO, "[WSProxy::proxy] websocket closed with code=", err, " msg=", data)
            break
        elseif typ == "ping" then
            ngx.log(ngx.DEBUG, "[WSProxy::proxy] self._ws:recv_frame received ping ", data)
            local bytes = nil
            bytes, err = self._ws:send_pong(data)
            if not bytes then
                ngx.log(ngx.ERR, "[WSProxy::proxy] self._ws:send_pong ", err)
                self._do_sock_recv_code = 4002
                self._do_sock_recv_err = err
                break
            end
        elseif typ == "pong" then
            ngx.log(ngx.DEBUG, "[WSProxy::proxy] self._ws:recv_frame received pong ", data)
        elseif typ == "text" then
            ngx.log(ngx.DEBUG, "[WSProxy::proxy] self._ws:recv_frame received text of ", #data)
            if self.ws_prefer_binary == nil then
                self.ws_prefer_binary = false
            end
            local bytes = nil
            bytes, err = self._rs:send(data)
            if not bytes then
                ngx.log(ngx.ERR, "[WSProxy::proxy] self._rs:send: ", err)
                self._do_sock_recv_code = 4002
                self._do_sock_recv_err = err
                break
            end
        elseif typ == "binary" then
            ngx.log(ngx.DEBUG, "[WSProxy::proxy] self._ws:recv_frame received binary of ", #data)
            if self.ws_prefer_binary == nil then
                self.ws_prefer_binary = true
            end
            local bytes = nil
            bytes, err = self._rs:send(data)
            if not bytes then
                ngx.log(ngx.ERR, "[WSProxy::proxy] self._rs:send: ", err)
                self._do_sock_recv_code = 4002
                self._do_sock_recv_err = err
                break
            end
        end
    end
    self._running = false
end

function WSProxy.proxy(self, type, host, port, mode, server_name)
    proxy_inner(self, type, host, port, mode)
    if self._co then
        local ok, err2 = ngx.thread.kill(self._co)
        if not ok then
            ngx.log(ngx.ERR, "[WSProxy::proxy] ngx.thread.kill ", err2)
        end
        self._co = nil
    end
    if self._rs and not self._rs_closed then
        local ok, err2 = self._rs:close()
        if not ok then
            ngx.log(ngx.ERR, "[WSProxy::proxy] self._rs:close ", err2)
        end
        self._rs_closed = true
    end
    if self._ws and not self._ws_closed then
        local code = self._do_sock_recv_code or 1000
        local err = self._do_sock_recv_err or ''
        local ok, err2 = self._ws:send_close(code, err)
        if not ok then
            ngx.log(ngx.ERR, "[WSProxy::proxy] self._ws:send_close ", err2)
        end
        self._ws_closed = true
    end
end

WSProxy.ipfilter = IPFilter.new(CFGDATA.wsproxy.blacklist)

return WSProxy