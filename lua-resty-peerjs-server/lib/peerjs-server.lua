--- implement of peerjs-server ---

local debug = ngx.config.debug
local ngx = ngx
local new_tab = require "table.new"
local WebsocketServer = require "resty.websocket.server"
local json = require "cjson.safe"

local _M = { 
    _VERSION = "0.0.1"
---@class PeerJSServer
---@field transmission table Transmission
---@field options table 
}

local mt = { __index = _M }

local function merge_options(options)
    return {
        ws_opts = options.ws_opts,
        allow_discovery = options.allow_discovery or false,
        subs_timeout = options.subs_timeout or 1.0,
    }
end

---comment create a PeerJSServer 
---@param transmission table Transmission
---@param options table? options
---@return table self
function _M.new(transmission, options)
    return setmetatable({ 
        transmission = transmission,
        options = merge_options(options)
    }, mt)
end


local UUID_DEV = "/proc/sys/kernel/random/uuid"

local function gen_uuid()
    local ifile = io.open(UUID_DEV)
    if not ifile then
        return nil
    end
    return ifile:read()
end


---comment GET `/<key>/id` - return a new user id
---@param self table PeerJSServer
---@param key string
---@return integer status
function _M.api_get_id(self, key)
    local uuid = gen_uuid()
    ngx.header.content_type = "text/plain"
    ngx.print(uuid)
    return ngx.OK
end


---comment GET `/<key>/peers` - return an array of all connected users
---@param self table PeerJSServer
---@param key string
---@return integer status
function _M.api_get_peers(self, key)
    if self.options.allow_discovery then
        local transmission = self.transmission
        local key_len = key:len()
        local filter = function(k)
            if k:find(key, 1, true) == 1 then
                return k:sub(key_len + 2)
            else
                return nil
            end
        end
        local peers = transmission:get_subscribers(filter)
        ngx.header.content_type = "application/json"
        ngx.print(json.encode(peers))
        return ngx.OK
    else
        ngx.header.content_type = "application/json"
        ngx.status = ngx.HTTP_UNAUTHORIZED
        ngx.print("")
        return ngx.OK
    end
end


-- enum MessageType {
-- 	 OPEN = "OPEN",
-- 	 LEAVE = "LEAVE",    // server-side transmission
-- 	 CANDIDATE = "CANDIDATE",    // server-side transmission
-- 	 OFFER = "OFFER",    // server-side transmission
-- 	 ANSWER = "ANSWER",    // server-side transmission
-- 	 EXPIRE = "EXPIRE",    // server-side transmission
-- 	 HEARTBEAT = "HEARTBEAT",    // server-side record
-- 	 ID_TAKEN = "ID-TAKEN",
-- 	 ERROR = "ERROR",
-- }

-- interface IMessage {
-- 	 type: MessageType;
-- 	 src?: string;
-- 	 dst?: string;
-- 	 payload?: string;
-- }

local MSGTY_OPEN = "OPEN"
local MSGTY_LEAVE = "LEAVE"
local MSGTY_CANDIDATE = "CANDIDATE"
local MSGTY_OFFER = "OFFER"
local MSGTY_ANSWER = "ANSWER"
local MSGTY_EXPIRE = "EXPIRE"
local MSGTY_HEARTBEAT = "HEARTBEAT"
local MSGTY_ID_TAKEN = "ID-TAKEN"
local MSGTY_ERROR = "ERROR"
local MSG_ID_IS_TAKEN =  {
    msg = "ID is taken"
}
local MSG_INVALID_KEY = {
    msg = "Invalid key provided"
}
local MSG_INVALID_TOKEN = {
    msg = "Invalid token provided"
}
local MSG_INVALID_WS_PARAMETERS = {
    msg = "No id, token, or key supplied to websocket server"
}
local MSG_CONNECTION_LIMIT_EXCEED = {
    msg = "Server has reached its concurrent user limit"
}
local MSG_ERROR_INTERNAL = {
    msg = "internal error"
}
local MSG_ERROR_JSON = {
    msg = "invalid message format"
}

local function server_send(ws, ty, src, tgt, payload)
    local msg_obj = {
        type = ty,
        src = src,
        dst = tgt,
        payload = payload,
    }
    local msg = json.encode(msg_obj)
    local bytes, err = ws:send_text(msg)
    if not bytes then
        ngx.log(ngx.ERR, "PeerJSServer:server_send failed to send text: ", err)
        return false
    end
    return true
end

local function server_close(ws, code, msg)
    local bytes, err0
    if code then
        msg = msg or ""
        bytes, err0 = ws:send_close(code, msg)
    else
        bytes, err0 = ws:send_close()
    end
    if not bytes then
        ngx.log(ngx.ERR, "PeerJSServer:server_send failed to send close: ", err0)
    end
end

--- handle: (key, msg, raw, ws, subscriber) -> quit: bool

local function handle_leave(key, msg, raw, ws, subscriber)
    return true
end

local function handle_expire(key, msg, raw, ws, subscriber)
    
end

local function handle_transmit(key, msg, raw, ws, subscriber)
        
end

local function handle_heartbeat(key, msg, raw, ws, subscriber)
        
end

local HANDLERS = {
    [MSGTY_OPEN] = nil,
    [MSGTY_LEAVE] = handle_leave,
    [MSGTY_CANDIDATE] = handle_transmit,
    [MSGTY_OFFER] = handle_transmit,
    [MSGTY_ANSWER] = handle_transmit,
    [MSGTY_EXPIRE] = handle_transmit,
    [MSGTY_HEARTBEAT] = handle_heartbeat,
    [MSGTY_ID_TAKEN] = nil,
    [MSGTY_ERROR] = nil,
}

local function check_key(key, id, token)
    -- TODO
    return true
end

local function check_client(key, id, token)
    -- TODO
    return true
end

local function handle_msg(key, raw, ws, subscriber)
    local msg = json.decode(raw)
    if not msg then
        ngx.log(ngx.WARN, "PeerJSServer:handle_msg failed to decode message: ", raw)
        server_send(ws, MSGTY_ERROR, nil, nil, MSG_ERROR_JSON)
        return false
    end
    local handler = HANDLERS[msg.type]
    if handler then
        return handler(key, msg, raw, ws, subscriber)
    else
        ngx.log(ngx.WARN, "PeerJSServer:handle_msg unknown message type: ", msg.type)
        server_send(ws, MSGTY_ERROR, nil, nil, { msg = ("invalid message type: " .. msg.type) })
        return false
    end
end

local CMD_HEAD = string.byte("#")

local function send_loop(ws, subscriber, timeout, status)
    while true do
        local data, err = subscriber:wait(timeout)
        if not data then
            if string.find(err, "timeout", 1, true) then
                if debug then
                    ngx.log(ngx.DEBUG, "PeerJSServer:send_loop timeout")
                end
            else
                ngx.log(ngx.ERR, "PeerJSServer:send_loop failed to wait data: ", err)
                status.error = err
                local ok
                ok, err = ws:send_close(1000, "internal error")
                break
            end
        else
            if data:byte() == CMD_HEAD then
                if string.find(data, "#close", 1, true) then
                    break
                end
            else
                local bytes
                bytes, err = ws:send_text(data)
                if not bytes then
                    ngx.log(ngx.ERR, "PeerJSServer:send_loop failed to send text: ", err)
                    status.error = err
                    break
                end
            end
        end
    end
    status.running = false
end

---comment `/peerjs?key=<key>&id=<id>&token=<token>`
---@param key string
---@param id string
---@param token string
---@return integer status
function _M.serve_peerjs(self, key, id, token)
    -- step 1. establish websocket
    local ws, err = WebsocketServer:new(self.options.ws_opts)
    if not ws then
        ngx.log(ngx.ERR, "PeerJSServer:serve_peerjs failed to establish websocket: ", err)
        ngx.status = ngx.HTTP_CLOSE
        return ngx.ERROR
    end
    -- step 2. register
    if key == nil or id == nil or token == nil then
        ngx.log(ngx.ERROR, "PeerJSServer:serve_peerjs parameter missing")
        server_send(ws, MSGTY_ID_TAKEN, nil, nil, MSG_INVALID_WS_PARAMETERS)
        server_close(ws)
        return ngx.ERROR
    end
    if not check_key(key, id, token) then
        ngx.log(ngx.ERROR, "PeerJSServer:serve_peerjs check_client failed")
        server_send(ws, MSGTY_ID_TAKEN, nil, nil, MSG_INVALID_KEY)
        server_close(ws)
        return ngx.ERROR
    end
    if not check_client(key, id, token) then
        ngx.log(ngx.ERROR, "PeerJSServer:serve_peerjs check_client failed")
        server_send(ws, MSGTY_ID_TAKEN, nil, nil, MSG_ID_IS_TAKEN)
        server_close(ws)
        return ngx.ERROR
    end
    local transmission = self.transmission
    local ukey = key .. "/" .. id
    local subscriber
    subscriber, err = transmission:subscribe(ukey)
    if not subscriber then
        ngx.log(ngx.ERR, "PeerJSServer:serve_peerjs failed to subscribe: ", err)
        server_send(ws, MSGTY_ID_TAKEN, nil, nil, MSG_CONNECTION_LIMIT_EXCEED)
        server_close(ws)
        return ngx.ERROR
    end
    -- step 3. start send loop
    local status = {
        running = true,
        error = nil,
    }
    local co = ngx.thread.spawn(send_loop, ws, subscriber, self.options.subs_timeout, status)
    if not co then
        ngx.log(ngx.ERR, "PeerJSServer:serve_peerjs failed to spawn send_loop")
        status.running = false
        server_send(ws, MSGTY_ERROR, nil, nil, MSG_ERROR_INTERNAL)
    else
        server_send(ws, MSGTY_OPEN, nil, nil, nil)
    end
    -- step 4. recv loop
    while status.running do
        local data, typ
        data, typ, err = ws:recv_frame()
        if debug then
            if data then
                ngx.log(ngx.DEBUG, "PeerJSServer:serve_peerjs recv_frame typ=", typ," data=[", #data, "] err=", err)
            else
                ngx.log(ngx.DEBUG, "PeerJSServer:serve_peerjs recv_frame typ=", typ," err=", err)
            end
        end
        if not data and not typ then
            if string.find(err, "timeout", 1, true) then
                -- PASS
            elseif string.find(err, "again", 1, true) then
                -- PASS
            else
                ngx.log(ngx.ERR, "PeerJSServer:serve_peerjs failed to receive frame: ", err)
                server_send(ws, MSGTY_ERROR, nil, nil, MSG_ERROR_INTERNAL)
                break
            end
        elseif typ == "close" then
            ngx.log(ngx.INFO, "PeerJSServer:serve_peerjs received close frame code=", err, " reason=", data)
            break
        elseif typ == "continuation" then
            -- TODO
        elseif typ == "text" then
            local quit = handle_msg(key, data, ws, subscriber)
            if quit then
                break
            end
        elseif typ == "binary" then
            local quit = handle_msg(key, data, ws, subscriber)
            if quit then
                break
            end
        elseif typ == "ping" then
            local bytes, err1 = ws:send_pong(data)
            if not bytes then
                ngx.log(ngx.ERR, "PeerJSServer:serve_peerjs failed to send pong frame: ", err1)
                server_send(ws, MSGTY_ERROR, nil, nil, MSG_ERROR_INTERNAL)
                break
            end
        elseif typ == "pong" then
            -- PASS
        else
            ngx.log(ngx.WARN, "unknown frame type: ", typ)
            server_send(ws, MSGTY_ERROR, nil, nil, MSG_ERROR_INTERNAL)
            break
        end
    end
    -- TODO: clear
    return ngx.OK
end