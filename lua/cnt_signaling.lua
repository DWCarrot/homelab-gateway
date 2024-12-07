local ngx = require "ngx"
local Signaling = require "signaling"

--- /signaling/<channel_id>/<peer_id>[?timeout=<timeout>]

local function parse()
    local uri = ngx.var.uri
    local base = ngx.var.location
    if not string.find(uri, base, 1, true) == 1 then
        return "invalid url: location not match", nil, nil, nil
    end
    local i = string.len(base) + 1
    local j = string.find(uri, "/", i, true)
    if not j then
        return "invalid url: no channel_id", nil, nil, nil
    end
    local channel_id = string.sub(uri, i, j - 1)
    local k = string.find(uri, "/", j + 1, true)
    local peer_id
    if k then
        peer_id = string.sub(uri, j + 1, k - 1)
    else
        peer_id = string.sub(uri, j + 1)
    end
    local args = ngx.req.get_uri_args()
    local timeout = nil
    local timeout_s = args["timeout"]
    if timeout_s then
        timeout = tonumber(timeout_s, 10)
        if not timeout then
            return "invalid timeout", nil, nil, nil
        end
    end
    return nil, channel_id, peer_id, timeout
end

local err0, channel_id, peer_id, timeout = parse()
if err0 then
    ngx.status = 400
    ngx.print(err0)
    return ngx.OK
end

local method = ngx.req.get_method():upper()

if method == "POST" then
    ngx.req.read_body()
    local data = ngx.req.get_body_data()
    if not data then
        ngx.status = 400
        ngx.print("invalid request: no data")
        return ngx.OK
    end
    local resp, code = Signaling.instance:serve(channel_id, peer_id, data, timeout)
    ngx.status = code
    ngx.print(resp)
    return ngx.OK
else
    local json = require "cjson.safe"
    local obj = {
        channel_id = channel_id,
        peer_id = peer_id,
        timeout = timeout
    }
    local resp, err = json.encode(obj)
    if not resp then
        ngx.status = 500
        ngx.print("json encode error: ", err)
        return ngx.OK
    end
    ngx.status = 200
    ngx.print(resp)
    return ngx.OK
end

