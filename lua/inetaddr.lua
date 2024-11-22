local CFGDATA = require "CFGDATA"
local Resolver = require "resty.dns.resolver"
local bit = require "bit"
local ngx = require "ngx"
local new_tab = require "table.new"
local cidr = require "libcidr-ffi"
local cache = ngx.shared.cached_dns
local CIDR_IPV4 = 1
local CIDR_IPV6 = 2


local InetAddress = { version = "0.0.1" }
local mt = { __index = InetAddress }


InetAddress.MODE_DEFAULT = 0x1
InetAddress.MODE_IPV4 = 0x2
InetAddress.MODE_IPV6 = 0x4
InetAddress.MODE_PREFER_IPV4 = 0x3
InetAddress.MODE_PREFER_IPV6 = 0x5
InetAddress.SOCKET_TCP = 0x10
InetAddress.SOCKET_TLS = 0x30
InetAddress.SOCKET_UDP = 0x40


---comment
---@param s string
---@return self InetAddress
function InetAddress.new(s)
    local inner = {
        raw = s,
        v4 = new_tab(4, 0), -- ip_sct list, priority: high to low
        v4mask = 0,   -- mask for ipv4 ip_sct list, index over this marked in blacklist
        v6 = new_tab(4, 0), -- ip_sct list, priority: high to low
        v6mask = 0,   -- mask for ipv6 ip_sct list, index over this marked in blacklist
    }
    local ip_sct, err = cidr.from_str(s)
    if ip_sct then
        ngx.log(ngx.DEBUG, "[InetAddress::new] from raw ip: ", s)
        if ip_sct.proto == CIDR_IPV4 then
            table.insert(inner.v4, ip_sct)
            inner.v4mask = #inner.v4
        elseif ip_sct.proto == CIDR_IPV6 then
            table.insert(inner.v6, ip_sct)
            inner.v6mask = #inner.v6
        end
    end
    return setmetatable(inner, mt)
end


---comment
---@return boolean
function InetAddress.resolved(self)
    return #self.v4 > 0 or #self.v6 > 0
end


local function resolve_inner(resolver, domain, qtype, out_list, out_list_str)
    local options = { qtype = qtype }
    local answers, err, tries = resolver:query(domain, options)
    if not answers then
        return false, "[InetAddress::resolve_inner] resolver:query " .. err .. " with tries=" .. tries
    end
    if answers.errcode then
        return false, "[InetAddress::resolve_inner] resolver:query " .. answers.errstr .. "(" .. answers.errcode .. ")"
    end
    local ok = false
    for index, value in ipairs(answers) do
        if value.address then
            local ip_sct, err = cidr.from_str(value.address)
            if ip_sct then
                ok = true
                table.insert(out_list, ip_sct)
                if out_list_str ~= nil then
                    table.insert(out_list_str, value.address)
                end
            else
                ngx.log(ngx.DEBUG, "[InetAddress::resolve_inner] invalid ip: ", value.address, " (error: ", err, ")")
            end
        end
    end
    return ok, nil
end


---comment
---@param mode? integer InetAddress.MODE_*
---@param force? boolean force update
---@return boolean ok
---@return any err
function InetAddress.resolve(self, mode, force)
    if self:resolved() then
        return true
    end
    mode = mode or InetAddress.MODE_DEFAULT
    if mode == InetAddress.MODE_PREFER_IPV4 or mode == InetAddress.MODE_PREFER_IPV6 then
        mode = InetAddress.MODE_DEFAULT
    end
    if (not force) and cache then
        local value, flags = cache:get(self.raw)
        if value and flags == mode then
            local i = 1
            local j = string.find(value, "|", i, true)
            while j do
                local ip = string.sub(value, i, j - 1)
                i = j + 1
                j = string.find(value, "|", i, true)
                local ip_sct, err = cidr.from_str(ip)
                if ip_sct then
                    if ip_sct.proto == CIDR_IPV4 then
                        table.insert(self.v4, ip_sct)
                    elseif ip_sct.proto == CIDR_IPV6 then
                        table.insert(self.v6, ip_sct)
                    end
                else
                    ngx.log(ngx.DEBUG, "[InetAddress::new] invalid ip: ", ip, " (error: ", err, ")")
                end
            end
            local ip = string.sub(value, i)
            local ip_sct, err = cidr.from_str(ip)
            if ip_sct then
                if ip_sct.proto == CIDR_IPV4 then
                    table.insert(self.v4, ip_sct)
                elseif ip_sct.proto == CIDR_IPV6 then
                    table.insert(self.v6, ip_sct)
                end
            else
                ngx.log(ngx.DEBUG, "[InetAddress::new] invalid ip: ", ip, " (error: ", err, ")")
            end
            self.v4mask = #self.v4
            self.v6mask = #self.v6
            ngx.log(ngx.DEBUG, "[InetAddress::new] from cache [ ", self.raw, " ] = ", value, " resolved v4=", #self.v4, " v6=", #self.v6)
            return true
        end
    end
    
    local resolver, err = Resolver:new{
        nameservers = CFGDATA.dns.nameservers,
        retrans = CFGDATA.dns.retrans,
        timeout = CFGDATA.dns.timeout,
        no_random = true,
    }
    if not resolver then
        return false, "[InetAddress::resolve] Resolver:new " .. err
    end
    local out_list_str = nil
    if cache then
        out_list_str = new_tab(8, 0)
    end
    local ok = false
    if mode == InetAddress.MODE_DEFAULT or mode == InetAddress.MODE_IPV4 then
        ngx.log(ngx.DEBUG, "[InetAddress::resolve] resolve_inner ipv4 start: ", self.raw)
        local ok1, err1 = resolve_inner(resolver, self.raw, resolver.TYPE_A, self.v4, out_list_str)
        self.v4mask = #self.v4
        if ok1 then
            ngx.log(ngx.DEBUG, "[InetAddress::resolve] resolve_inner ipv4 end #", #self.v4, " err=", err1)
            ok = true
        elseif err1 and not err then
            err = err1
        end
    end
    if mode == InetAddress.MODE_DEFAULT or mode == InetAddress.MODE_IPV6 then
        ngx.log(ngx.DEBUG, "[InetAddress::resolve] resolve_inner ipv6 start: ", self.raw)
        self.v6mask = #self.v6
        local ok2, err2 = resolve_inner(resolver, self.raw, resolver.TYPE_AAAA, self.v6, out_list_str)
        if ok2 then
            ngx.log(ngx.DEBUG, "[InetAddress::resolve] resolve_inner ipv6 end #", #self.v6, " err=", err2)
            ok = true
        elseif err2 and not err then
            err = err2
        end
    end
    resolver:destroy()
    if out_list_str ~= nil then
        local value = table.concat(out_list_str, "|")
        local success, err2, forcible = cache:set(self.raw, value, CFGDATA.dns.cache, mode)
        if success then
            ngx.log(ngx.DEBUG, "[InetAddress::resolve] cache:set [ ", self.raw, " ] = ", value, ",flags=", mode)
        else
            ngx.log(ngx.ERR, "[InetAddress::resolve] cache:set [ ", self.raw, " ] failed: ", err2, " forcible=", forcible)
        end
    end
    return ok, err
end


local CIDR_FLAGS = bit.bor(cidr.flags.ONLYADDR, cidr.flags.VERBOSE)
local CIDR_FLAGS6 = bit.bor(CIDR_FLAGS, cidr.flags.FORCEV6)


---comment
---@return table
function InetAddress.dump(self)
    local resolved = nil
    if #self.v4 > 0 or #self.v6 > 0 then
        resolved = new_tab(#self.v4 + #self.v6, 0)
        for index, ip_sct in ipairs(self.v6) do
            local ipv6 = cidr.to_str(ip_sct, CIDR_FLAGS)
            table.insert(resolved, { ip = ipv6, family = "ipv6", mask = index <= self.v6mask})
        end
        for index, ip_sct in ipairs(self.v4) do
            local ipv4 = cidr.to_str(ip_sct, CIDR_FLAGS)
            local ipv6 = cidr.to_str(ip_sct, CIDR_FLAGS6)
            table.insert(resolved, { ip = ipv4, family = "ipv4", ipv6 = ipv6, mask = index <= self.v4mask})
        end
    end
    return {
        raw = self.raw,
        resolved = resolved
    }
end


---comment
---@param mode? integer InetAddress.MODE_* 
---@return string|nil
function InetAddress.pick(self, mode)
    mode = mode or InetAddress.MODE_DEFAULT
    local ip_sct = nil
    if mode == InetAddress.MODE_IPV6 or mode == InetAddress.MODE_PREFER_IPV6 or mode == InetAddress.MODE_DEFAULT then
        if 1 <= #self.v6 and 1 <= self.v6mask then
            ip_sct = self.v6[1]
        elseif mode ~= InetAddress.MODE_IPV6 and 1 <= #self.v4 and 1 <= self.v4mask then
            ip_sct = self.v4[1]
        end
    elseif mode == InetAddress.MODE_IPV4 or mode == InetAddress.MODE_PREFER_IPV4 then
        if 1 <= #self.v4 and 1 <= self.v4mask then
            ip_sct = self.v4[1]
        elseif mode ~= InetAddress.MODE_IPV4 and 1 <= #self.v6 and 1 <= self.v6mask then
            ip_sct = self.v6[1]
        end
    end
    if ip_sct then
        return cidr.to_str(ip_sct, CIDR_FLAGS)
    end
    return nil
end


---comment
---@param ty integer InetAddress.SOCKET_*
---@param port integer
---@param mode? integer InetAddress.MODE_*
---@param server_name? string
---@return table|nil socket
---@return any err
---@return string|nil ip
function InetAddress.create_socket(self, ty, port, mode, server_name)
    mode = mode or InetAddress.MODE_DEFAULT
    server_name = server_name or self.raw
    local socket, ip, ok, err
    local list, mask, next_list, next_mask
    if mode == InetAddress.MODE_DEFAULT or mode == InetAddress.MODE_PREFER_IPV6 then
        list = self.v6
        mask = self.v6mask
        next_list = self.v4
        next_mask = self.v4mask
    elseif mode == InetAddress.MODE_IPV6 then
        list = self.v6
        mask = self.v6mask
        next_list = nil
        next_mask = nil
    elseif mode == InetAddress.MODE_PREFER_IPV4 then
        list = self.v4
        mask = self.v4mask
        next_list = self.v6
        next_mask = self.v6mask
    elseif mode == InetAddress.MODE_IPV4 then
        list = self.v4
        mask = self.v4mask
        next_list = nil
        next_mask = nil
    else
        return nil
    end
    local index = 1
    while true do
        if index <= #list and index <= mask then
            local ip_sct = list[index]
            ip = cidr.to_str(ip_sct, CIDR_FLAGS)
            if ip_sct.proto == CIDR_IPV6 then
                ip = "[" .. ip .. "]"
            end
            if ty == InetAddress.SOCKET_TCP or ty == InetAddress.SOCKET_TLS then
                socket = ngx.socket.tcp()
                ok, err = socket:connect(ip, port)
                if not ok then
                    ngx.log(ngx.ERR, "[InetAddress::create_socket] socket:connect(", ip, ",", port, ") failed: ", err)
                    index = index + 1
                else
                    if ty == InetAddress.SOCKET_TLS then
                        ok, err = socket:sslhandshake(true, server_name)
                        if not ok then
                            socket:close()
                            return nil, "[InetAddress::create_socket] socket:sslhandshake failed: " .. err
                        end
                    end
                    break
                end
            elseif ty == InetAddress.SOCKET_UDP then
                socket = ngx.socket.udp()
                ok, err = socket:setpeername(ip, port)
                if not ok then
                    ngx.log(ngx.ERR, "[InetAddress::create_socket] socket:connect(", ip, ",", port, ") failed: ", err)
                    index = index + 1
                else
                    break
                end
            else
                return nil, "[InetAddress::create_socket] invalid socket type " .. ty
            end
        elseif next_list ~= nil then
            list = next_list
            mask = next_mask
            next_list = nil
            next_mask = nil
            index = 1
        else
            return nil, "[InetAddress::create_socket] all ip failed"
        end
    end
    return socket, nil, ip
end


return InetAddress