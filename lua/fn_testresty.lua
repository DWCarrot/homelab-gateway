local ngx = require "ngx"
local json = require "cjson.safe"
local new_tab = require "table.new"
local shared = ngx.shared

local DICT_NAME = "testresty_shd"
local KEY_OPTIONAL = string.byte("?")
local KEY_NUMERIC = string.byte("#")

---comment
---@param args table
---@param ... string
---@return any err
---@return string|number ... 
local function parse_args(args, ...)
    local fields = {...}
    local results = new_tab(0, #fields)
    for i, field in ipairs(fields) do
        local len = field:len()
        local optional = field:byte(len) == KEY_OPTIONAL
        if optional then
            len = len - 1
        end
        local numeric = field:byte(len) == KEY_NUMERIC
        if numeric then
            len = len - 1
        end
        if len < field:len() then
            field = field:sub(1, len)
        end
        local value = args[field]
        if not value and not optional then
            return "missing field\"" .. field .. "\""
        end
        if value and numeric then
            local n_value = tonumber(value)
            if n_value == nil then
                return "invalid numeric " .. value .. " for field\"" .. field .. "\""
            end
            value = n_value
        end
        results[field] = value
    end
    return nil, results
end

local function transform_value(value, vt)
    local result = value
    if vt == "n" then
        local n = tonumber(value)
        if n ~= nil then
            result = n
        end
    -- elseif vt == "n2" then
    --     local n = tonumber(value)
    --     if n ~= nil then
    --         result = string.pack("<I8", n)
    --     end
    end
    return result
end

local MAP_FUNC = {
    ["shared"] = {
        ["get"] = function (args, path, i)
            local err0, m = parse_args(args, "key")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local value, flags = dict:get(m.key)
            return { value = value, flags = flags }
        end,
        ["get_stale"] = function (args, path, i)
            local err0, m = parse_args(args, "key")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local value, flags, stale = dict:get_stale(m.key)
            return { value = value, flags = flags, stale = stale }
        end,
        ["set"] = function (args, path, i)
            local err0, m = parse_args(args, "key", "value", "expires#?", "flags#?", "vt?")
            if err0 then
                return nil, err0
            end
            if m.vt then
                m.value = transform_value(m.value, m.vt)
            end
            local dict = shared[DICT_NAME]
            local ok, err, forcible = dict:set(m.key, m.value, m.expires, m.flags)
            return { ok = ok, err = err, forcible = forcible }
        end,
        ["safe_set"] = function (args, path, i)
            local err0, m = parse_args(args, "key", "value", "expires#?", "flags#?", "vt?")
            if err0 then
                return nil, err0
            end
            if m.vt then
                m.value = transform_value(m.value, m.vt)
            end
            local dict = shared[DICT_NAME]
            local ok, err = dict:safe_set(m.key, m.value, m.expires, m.flags)
            return { ok = ok, err = err }
        end,
        ["add"] = function (args, path, i)
            local err0, m = parse_args(args, "key", "value", "expires#?", "flags#?", "vt?")
            if err0 then
                return nil, err0
            end
            if m.vt then
                m.value = transform_value(m.value, m.vt)
            end
            local dict = shared[DICT_NAME]
            local ok, err, forcible  = dict:add(m.key, m.value, m.expires, m.flags)
            return { ok = ok, err = err, forcible = forcible }
        end,
        ["safe_add"] = function (args, path, i)
            local err0, m = parse_args(args, "key", "value", "expires#?", "flags#?", "vt?")
            if err0 then
                return nil, err0
            end
            if m.vt then
                m.value = transform_value(m.value, m.vt)
            end
            local dict = shared[DICT_NAME]
            local ok, err = dict:safe_add(m.key, m.value, m.expires, m.flags)
            return { ok = ok, err = err }
        end,
        ["replace"] = function (args, path, i)
            local err0, m = parse_args(args, "key", "value", "expires#?", "flags#?", "vt?")
            if err0 then
                return nil, err0
            end
            if m.vt then
                m.value = transform_value(m.value, m.vt)
            end
            local dict = shared[DICT_NAME]
            local ok, err, forcible = dict:replace(m.key, m.value, m.expires, m.flags)
            return { ok = ok, err = err, forcible = forcible }
        end,
        ["delete"] = function (args, path, i)
            local err0, m = parse_args(args, "key")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            dict:delete(m.key)
            return { ok = true }
        end,
        ["incr"] = function (args, path, i)
            local err0, m = parse_args(args, "key", "value#", "init#?", "init_ttl#?")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local newval, err, forcible = dict:incr(m.key, m.value, m.init, m.init_ttl)
            return { newval = newval, err = err, forcible = forcible }
        end,
        ["lpush"] = function (args, path, i)
            local err0, m = parse_args(args, "key", "value", "vt?")
            if err0 then
                return nil, err0
            end
            if m.vt then
                m.value = transform_value(m.value, m.vt)
            end
            local dict = shared[DICT_NAME]
            local length, err = dict:lpush(m.key, m.value)
            return { length = length, err = err }
        end,
        ["rpush"] = function (args, path, i)
            local err0, m = parse_args(args, "key", "value", "vt?")
            if err0 then
                return nil, err0
            end
            if m.vt then
                m.value = transform_value(m.value, m.vt)
            end
            local dict = shared[DICT_NAME]
            local length, err = dict:rpush(m.key, m.value)
            return { length = length, err = err }
        end,
        ["lpop"] = function (args, path, i)
            local err0, m = parse_args(args, "key")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local value, err = dict:lpop(m.key)
            return { value = value, err = err }
        end,
        ["rpop"] = function (args, path, i)
            local err0, m = parse_args(args, "key")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local value, err = dict:rpop(m.key)
            return { value = value, err = err }
        end,
        ["llen"] = function (args, path, i)
            local err0, m = parse_args(args, "key")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local len, err = dict:llen(m.key)
            return { len = len, err = err }
        end,
        ["ttl"] = function (args, path, i)
            local err0, m = parse_args(args, "key")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local ttl, err = dict:ttl(m.key)
            return { ttl = ttl, err = err }
        end,
        ["expire"] = function (args, path, i)
            local err0, m = parse_args(args, "key", "expires#")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local value, err = dict:expire(m.key, m.expires)
            return { value = value, err = err }
        end,
        ["flush_all"] = function (args, path, i)
            local dict = shared[DICT_NAME]
            dict:flush_all()
            return { ok = true }
        end,
        ["flush_expired"] = function (args, path, i)
            local err0, m = parse_args(args, "max_count#?")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local flushed = dict:flush_expired(m.max_count)
            return { flushed = flushed }
        end,
        ["get_keys"] = function (args, path, i)
            local err0, m = parse_args(args, "max_count#?")
            if err0 then
                return nil, err0
            end
            local dict = shared[DICT_NAME]
            local keys = dict:get_keys(m.max_count)
            return { keys = keys }
        end,
        ["capacity"] = function (args, path, i)
            local dict = shared[DICT_NAME]
            local capacity = dict:capacity()
            return { capacity = capacity }
        end,
        ["free_space"] = function (args, path, i)
            local dict = shared[DICT_NAME]
            local free_space = dict:free_space()
            return { free_space = free_space }
        end,
    }
}



---comment
---@return any? err
---@return table path array
---@return table args map
local function parse()
    local uri = ngx.var.uri
    local base = ngx.var.location
    if not string.find(uri, base, 1, true) == 1 then
        return "location not match"
    end
    local i = string.len(base) + 1
    local path = new_tab(2, 0)
    while i > 0 do
        local j = string.find(uri, "/", i, true)
        if j then
            local part = string.sub(uri, i, j - 1)
            table.insert(path, part)
            i = j + 1
        else
            local part = string.sub(uri, i)
            table.insert(path, part)
            i = -1
        end
    end
    local args = ngx.req.get_uri_args()
    return nil, path, args
end


local _M = new_tab(0, 1)

function _M.execute()
    local err, path, args = parse()
    if err then
        ngx.status = ngx.HTTP_BAD_REQUEST
        ngx.print(err)
        return ngx.exit(ngx.OK)
    end
    ngx.log(ngx.DEBUG, "path=", json.encode(path), " args=", json.encode(args))
    local func = MAP_FUNC
    for i, segment in ipairs(path) do
        func = func[segment]
        if not func then
            break
        end
        if type(func) == "function" then
            local result
            result, err = func(args, path, i + 1)
            if not result then
                ngx.status = ngx.HTTP_BAD_REQUEST
                ngx.print(err)
                return ngx.exit(ngx.OK)
            end
            local response = json.encode({
                path = path,
                args = args,
                result = result,
            })
            ngx.print(response)
            return ngx.exit(ngx.OK)
        end
    end
    ngx.status = ngx.HTTP_NOT_FOUND
    ngx.exit(ngx.OK)
end

return _M