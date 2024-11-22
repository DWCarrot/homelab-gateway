local InetAddress = require "inetaddr"
local new_tab = require "table.new"
local clear_tab = require "table.clear"
local cidr = require "libcidr-ffi"
local CIDR_IPV4 = 1
local CIDR_IPV6 = 2


local IPFilter = { version = "0.0.1" }
local mt = { __index = IPFilter }


---comment
---@param blacklist table<string> ip blacklist array
---@return self IPFilter
---@return any err
function IPFilter.new(blacklist)
    local v4 = new_tab(#blacklist, 0)
    local v6 = new_tab(#blacklist, 0)
    for index, value in ipairs(blacklist) do
        local ip_sct, err = cidr.from_str(value)
        if not ip_sct then
            return nil, err
        end
        if ip_sct.proto == CIDR_IPV4 then
            table.insert(v4, ip_sct)
        elseif ip_sct.proto == CIDR_IPV6 then
            table.insert(v6, ip_sct)
        end
    end
    return setmetatable({ v4 = v4, v6 = v6 }, mt), nil
end


local function apply_one(tgt, blacklist)
    if tgt == nil or #tgt == 0 then
        return tgt, 0
    end
    local tgt_len = #tgt
    local tgt_ext = new_tab(tgt_len, 0)
    for index_tgt, ip_sct_tgt in ipairs(tgt) do
        local mask = tgt_len - index_tgt + 1
        for index_b, ip_sct_b in ipairs(blacklist) do
            if cidr.contains(ip_sct_b, ip_sct_tgt) then
                mask = -1
                break
            end
        end
        table.insert(tgt_ext, { ip_sct = ip_sct_tgt, mask = mask })
    end
    local function compare(x, y)
        return x.mask > y.mask
    end
    table.sort(tgt_ext, compare)
    local mask = 0
    clear_tab(tgt)
    for index, value in ipairs(tgt_ext) do
        if value.mask > -1 then
            mask = index
        end
        table.insert(tgt, value.ip_sct)
    end
    return tgt, mask
end

---comment
---@param addr table InetAddress
---@return boolean
function IPFilter.apply(self, addr)
    addr.v4, addr.v4mask = apply_one(addr.v4, self.v4)
    addr.v6, addr.v6mask = apply_one(addr.v6, self.v6)
    return true
end

local demo_blacklist = {
    "127.0.0.1/8",
    "::1/128",
}

IPFilter.demo = IPFilter.new(demo_blacklist)

return IPFilter