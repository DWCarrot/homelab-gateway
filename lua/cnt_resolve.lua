local ngx = require "ngx"
local json = require "cjson.safe"
local InetAddress = require "inetaddr"
local IPFilter = require "ipfilter"

local MAP_MODE = {
    ["v4"] = InetAddress.MODE_IPV4,
    ["v6"] = InetAddress.MODE_IPV6,
    ["v4+"] = InetAddress.MODE_PREFER_IPV4,
    ["v6+"] = InetAddress.MODE_PREFER_IPV6,
}

local function parse()
    local uri = ngx.var.uri
    local base = ngx.var.location
    if not string.find(uri, base, 1, true) == 1 then
        return nil, nil, nil, nil, "invalid url: location not match"
    end
    local i = string.len(base) + 1
    local j = string.find(uri, "/", i, true)
    local target = string.sub(uri, i, j)
    local args = ngx.req.get_uri_args()
    local resolve_mode = args["r"]
    if resolve_mode then
        resolve_mode = MAP_MODE[resolve_mode]
    end
    local pick_mode = args["p"]
    if pick_mode then
        pick_mode = MAP_MODE[pick_mode]
    end
    local force_update = args["u"]
    if force_update then
        local v = tonumber(force_update, 16);
        if v then
            force_update = v > 0
        else
            force_update = (string.lower(force_update) == "true")
        end
    end
    return target, resolve_mode, pick_mode, force_update, nil
end

local host, r, p, u, err1 = parse()
if not host then
    ngx.status = ngx.HTTP_BAD_REQUEST
    ngx.print(err1)
    return ngx.exit(ngx.OK)
else
    local ipfilter = IPFilter.demo
    local addr = InetAddress.new(host)
    local ok, err = addr:resolve(r, u)
    if ok then
        ipfilter:apply(addr)
    end
    local data = {
        path = ngx.var.uri,
        args = {
            r = r,
            p = p,
            u = u
        },
        target = addr.raw,
        resolved = addr:dump(),
        picked = addr:pick(p),
        err = err
    }
    ngx.print(json.encode(data))
    return ngx.exit(ngx.OK)
end


