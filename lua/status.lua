local ngx = require "ngx"
local shell = require "resty.shell"
local new_tab = require "table.new"
local libc = require "libc_ffi"

local _M = { version = "0.1" }

local CHAR_CR = 13
local CHAR_LF = 10
local LF = string.char(CHAR_LF)

local function handle_lines(s, callback, results)
    local i = 1
    local j = string.find(s, LF, i, true)
    while j do
        local k = j - 1
        if string.byte(s, k) == CHAR_CR then
            k = k - 1
        end
        local line = string.sub(s, i, k)
        i = j + 1
        j = string.find(s, LF, i, true)
        local ok, err = callback(line, results)
        if not ok then
            return false, err
        end
    end
    local line = string.sub(s, i)
    local ok, err = callback(line, results)
    if not ok then
        return false, err
    end
end


local IP_ADDRESS_CMD = "ip addr"
local IP_ADDRESS_PATTERN_INDEX = [[^(\d+):\s+(\w+):.*$]]
local IP_ADDRESS_PATTERN_IP = [[^\s+(inet6?)\s+(([0-9a-f.:]+)\/\d+).*$]]

function _M.get_ip_addresses()
    local info = new_tab(0, 16)
    local stdin = nil
    local timeout = 1000
    local max_size = 4096
    local ok, stdout, stderr, reason, status = shell.run(IP_ADDRESS_CMD, stdin, timeout, max_size)
    if ok then
        local current = nil
        local function callback(line, results)
            if #line > 0 then
                local m, err = ngx.re.match(line, IP_ADDRESS_PATTERN_INDEX, "jo")
                if m then
                    -- m[1] index, m[2] name
                    current = new_tab(0, 16)
                    results[m[2]] = current
                else
                    if current then
                        m, err = ngx.re.match(line, IP_ADDRESS_PATTERN_IP, "jo")
                        if m then
                            -- m[1] family, m[2] address mask, m[3] address
                            if m[1] == "inet" then
                                current.ipv4 = m[3]
                                current.ipv4_mask = m[2]
                            elseif m[1] == "inet6" then
                                current.ipv6 = m[3]
                                current.ipv6_mask = m[2]
                            end
                        end
                    end
                end
            end
            return true, nil
        end
        local err
        ok, err = handle_lines(stdout, callback, info)
    else
        ngx.log(ngx.ERR, "[get_ip_addresses] failed to execute command (", status, "): ", reason)
    end
    return info
end


local DISK_USAGE_CMD = "df -B 1K"
local DISK_USAGE_PATTERN = [[^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\S+)$]]

function _M.get_disk_usage()
    local info = new_tab(16, 0)
    local stdin = nil
    local timeout = 1000
    local max_size = 4096
    local ok, stdout, stderr, reason, status = shell.run(DISK_USAGE_CMD, stdin, timeout, max_size)
    if ok then
        local function callback(line, results)
            if #line > 0 then
                local m, err = ngx.re.match(line, DISK_USAGE_PATTERN, "jo")
                if m then
                    -- m[1] filesystem, m[2] size, m[3] used, m[4] available, m[5] usage, m[6] mount
                    local item = {
                        filesystem = m[1],
                        size = tonumber(m[2]) * 1024,
                        used = tonumber(m[3]) * 1024,
                        available = tonumber(m[4]) * 1024,
                        -- usage = tonumber(m[5]) / 100.0,
                        mount = m[6],
                    }
                    if item.filesystem == "none" then
                        item.filesystem = nil
                    end
                    table.insert(results, item)
                end
            end
            return true, nil
        end
        local err
        ok, err = handle_lines(stdout, callback, info)
    else
        ngx.log(ngx.ERR, "[get_disk_usage] failed to execute command (", status, "): ", reason)
    end
    return info
end


local MEMORY_INFO_PATTERN = [[^(\S+):\s*(\d+)\s*(kB)?$]]
local MEMORY_INFO_KEYS = {
    MemTotal = "total",
    MemFree = "free",
    MemAvailable = "available",
    Buffers = "buffers",
    Cached = "cached",
}

function _M.get_memory_info()
    local path = "/proc/meminfo"
    local ifile = io.open(path, "r")
    if not ifile then
        ngx.log(ngx.DEBUG, "[get_memory_info] failed to open file: ", path)
        return {}
    end
    local info = new_tab(0, #MEMORY_INFO_KEYS)
    for line in ifile:lines() do
        local m, err = ngx.re.match(line, MEMORY_INFO_PATTERN, "jo")
        if m then
            local key = MEMORY_INFO_KEYS[m[1]]
            if key then
                local value = tonumber(m[2])
                if m[3] then
                    if string.upper(m[3]) == "KB" then
                        value = value * 1024
                    end
                end
                info[key] = value
            end
        end
    end
    return info
end

local TEMPERATURE_THERMAL_ZONES = {
    "thermal_zone0",
    "thermal_zone1",
    "thermal_zone2",
    "thermal_zone3",
    "thermal_zone4",
    "thermal_zone5",
    "thermal_zone6",
}

function _M.get_temperature()
    local info = new_tab(0, #TEMPERATURE_THERMAL_ZONES)
    for index, value in ipairs(TEMPERATURE_THERMAL_ZONES) do
        local root = "/sys/class/thermal/" .. value
        local temp_path = root .. "/temp"
        local temp_file = io.open(temp_path, "r")
        if temp_file then
            local temp_str = temp_file:read("*a")
            temp_file:close()
            local temp = tonumber(temp_str)
            if temp then
                local offset_path = root .. "/offset"
                local offset_file = io.open(offset_path, "r")
                if offset_file then
                    local offset_str = offset_file:read("*a")
                    offset_file:close()
                    local offset = tonumber(offset_str)
                    if offset then
                        temp = temp - offset
                    end
                end
                info[value] = temp / 1000.0
            end
        end
    end
    return info
end


function _M.get_system_info()
    local path = "/proc/uptime"
    local ifile = io.open(path, "r")
    if not ifile then
        ngx.log(ngx.DEBUG, "[get_system_info] failed to open file: ", path)
        return {}
    end
    local system_up_time = ifile:read("*n")
    local system_idle_time = ifile:read("*n")
    ifile:close()
    if not system_up_time or not system_idle_time then
        ngx.log(ngx.DEBUG, "[get_system_info] invalid format ", system_up_time, " ", system_idle_time)
        return {}
    end
    local nproc = libc.get_nprocs()
    path = "/proc/loadavg"
    ifile = io.open(path, "r")
    if not ifile then
        ngx.log(ngx.DEBUG, "[get_system_info] failed to open file: ", path)
        return {}
    end
    local loadavg_1m = ifile:read("*n")
    local loadavg_5m = ifile:read("*n")
    local loadavg_15m = ifile:read("*n")
    ifile:close()
    if not loadavg_1m or not loadavg_5m or not loadavg_15m then
        ngx.log(ngx.DEBUG, "[get_system_info] invalid format ", loadavg_1m, " ", loadavg_5m, " ", loadavg_15m)
        return {}
    end
    path = "/proc/version"
    ifile = io.open(path, "r")
    if not ifile then
        ngx.log(ngx.DEBUG, "[get_system_info] failed to open file: ", path)
        return {}
    end
    local version = ifile:read("*l")
    ifile:close()
    return {
        uptime = system_up_time * 1000,
        nproc = nproc,
        load_1m = loadavg_1m,
        load_5m = loadavg_5m,
        load_15m = loadavg_15m,
        -- idle = system_idle_time / (system_up_time * nproc),
        version = version,
    }
end

return _M