--- implement of Transmission and Subscriber with shared.DICT ---

local ngx = ngx
local debug = ngx.config.debug
local shared = ngx.shared
local new_tab = require "table.new"
local Semaphore = require "ngx.semaphore"

local SLOTS_PREFIX = "@"
local INDEX_PREFIX = "#"
local INDEX_PREFIX_KEY = INDEX_PREFIX:byte()
local QUEUE_PREFIX = "$"
local QUEUE_HEAD_PREFIX = "<"
local QUEUE_TAIL_PREFIX = ">"
local QUEUE_LOCK_TTL = 10


local _M = {
    _VERSION = "0.0.1"
---@class Transmission
---@field dict table shared dict
---@field slots table array
---@field slots_key string key of the slots available
}

local mt = { __index = _M }


local _M_Subscriber = {
    _VERSION = "0.0.1"
---@class Subscriber
---@field sema table ngx.semaphore
---@field ukey string key of the queue
---@field mgr table Transmission
}

local mt_Subscriber = { __index = _M_Subscriber }


--#region Transmission


---@param dict table shared-dict
---@param key string
---@param data string
---@param index_timeout number
---@param message_timeout number
local function push_message(dict, key, data, index_timeout, message_timeout)
    local tail_key = QUEUE_TAIL_PREFIX .. key
    local newval, err, forcible = dict:incr(tail_key, 1, 0, index_timeout)
    if not newval then
        return false, err
    end
    local msg_key = QUEUE_PREFIX .. key .. tostring(newval)
    local success
    success, err, forcible = dict:add(msg_key, data, message_timeout)
    if not success then
        local oldval, err0, forcible0 = dict:incr(tail_key, -1)
        return false, err
    end
    if newval > 1 then
        success, err = dict:expire(tail_key, index_timeout)
        local head_key = QUEUE_HEAD_PREFIX .. key
        success, err = dict:expire(head_key, index_timeout)
    end
    return true
end

local function pop_message(dict, key, index_timeout, message_timeout)
    
end

---comment
---@param dict_name string name of the shared dict
---@param slots_capacity integer capacity of the slots, AKA the max number of subscribers
---@return table? self Transmission; nil if err
---@return any? err error message
function _M.new(dict_name, slots_capacity)
    local dict = shared[dict_name]
    if not dict then
        return nil, "dict not found"
    end
    local slots = new_tab(slots_capacity, 0)
    local slots_key = SLOTS_PREFIX
    local length, err
    for i = slots_capacity, 1, -1 do
        length, err = dict:rpush(slots_key, i)
        if not length then
            return nil, err
        end
    end
    if debug then
        ngx.log(ngx.DEBUG, "Transmission:new init available ", slots_key, " count=", length)
    end
    return setmetatable({ 
        dict = dict,
        slots = slots,
        slots_key = slots_key,
    }, mt)
end

---comment subscribe to a key
---@param key string key to subscribe; should not be nil or empty
---@return table? subscriber Subscriber; nil if err
---@return any? err error message; "existed" if key already subscribed, "full" if slots full, or other error messages
function _M.subscribe(self, key)
    local dict = self.dict
    local slots = self.slots
    local slots_key = self.slots_key
    local subs_key = INDEX_PREFIX .. key
    local slot_index, flags = dict:get(subs_key)
    if debug then
        ngx.log(ngx.DEBUG, "Transmission:subscribe check get slot_index ", subs_key, " => ", slot_index, " ", flags)
    end
    if slot_index then
        return nil, "existed"
    end
    local err
    slot_index, err = dict:rpop(slots_key)
    if debug then
        ngx.log(ngx.DEBUG, "Transmission:subscribe pop available slot_index (", slots_key, ") ", slot_index, " ", err)
    end
    if not slot_index then
        return nil, err or "full"
    end
    local ok, forcible
    ok, err, forcible = dict:set(subs_key, slot_index)
    if debug then
        ngx.log(ngx.DEBUG, "Transmission:subscribe set slot_index ", subs_key, " => ", slot_index, " ", ok, " ", err, " ", forcible)
    end
    if not ok then
        local length, err0 = dict:lpush(slots_key, slot_index)
        if debug then
            ngx.log(ngx.DEBUG, "Transmission:subscribe rollback push available slot_index (", slots_key, ") ", slot_index, " ", length, " ", err0)
        end
        return nil, err
    end
    local sema, err = Semaphore.new(0)
    if not sema then
        dict:delete(subs_key)
        if debug then
            ngx.log(ngx.DEBUG, "Transmission:subscribe rollback set slot_index ", subs_key, " => ", slot_index)
        end
        local length, err0 = dict:lpush(slots_key, slot_index)
        if debug then
            ngx.log(ngx.DEBUG, "Transmission:subscribe rollback push available slot_index (", slots_key, ") ", slot_index, " ", length, " ", err0)
        end
        return nil, err
    end
    local queue_key = QUEUE_PREFIX .. key
    local subscriber = setmetatable({
        sema = sema,
        ukey = queue_key,
        mgr = self,
    }, mt_Subscriber)
    slots[slot_index] = sema
    if debug then
        ngx.log(ngx.DEBUG, "Transmission:subscribe register semaphore [", slot_index, "]")
    end
    dict:delete(queue_key)  -- unlock the queue
    if debug then
        ngx.log(ngx.DEBUG, "Transmission:subscribe unlock delete", queue_key)
    end
    return subscriber
end

---comment publish data to a key
---@param key string key to publish; should not be nil or empty
---@param data string data to publish; should not be nil or empty
---@return boolean ok
---@return any? err error message
function _M.publish(self, key, data)
    local dict = self.dict
    local slots = self.slots
    local subs_key = INDEX_PREFIX .. key
    local slot_index, flags = dict:get(subs_key)
    if debug then
        ngx.log(ngx.DEBUG, "Transmission:publish get slot_index ", subs_key, " => ", slot_index, " ", flags)
    end
    if not slot_index then
        return false, "unsubscribe"
    end
    local sema = slots[slot_index]
    if debug then
        ngx.log(ngx.DEBUG, "Transmission:publish acquire semaphore [", slot_index, "] ", sema ~= nil)
    end
    if sema then
        local queue_key = QUEUE_PREFIX .. key
        local length, err = dict:rpush(queue_key, data)
        if debug then
            ngx.log(ngx.DEBUG, "Transmission:publish enqueue ", queue_key, " ", length, " ", err)
        end
        if not length then
            return false, err
        end
        sema:post(1)
        return true
    end
    return false, "unsubscribe"
end

---comment get subscribers of all key
---@param self table Transmission
---@param filter function? (key: string) -> string? filter function to filter subscribers
---@return table
function _M.get_subscribers(self, filter)
    local dict = self.dict
    local max_count = #self.slots * 2 + 1  -- available-slots + slot_index[] + queue[] 
    local raw_keys = dict:get_keys(max_count)
    local results = new_tab(#raw_keys // 2, 0)
    for index, value in ipairs(raw_keys) do
        if value:byte() == INDEX_PREFIX_KEY then
            local key = value:sub(2)
            if filter then
                key = filter(key)
            end
            if key then
                table.insert(results, key)
            end
        end
    end
    return results
end

--#endregion Transmission


--#region Subscriber

---comment
---@param timeout number?
---@return string? data; nil if timeout or error
---@return any? err error message; "timeout" if timeout, "closed" if closed, or other error message
function _M_Subscriber.wait(self, timeout)
    local dict = self.mgr.dict
    local queue_key = self.ukey
    local sema = self.sema
    if not sema then
        return nil, "closed"
    end
    if debug then
        ngx.log(ngx.DEBUG, "Subscriber:wait wait start", queue_key)
    end
    local ok, err = sema:wait(timeout)
    if debug then
        ngx.log(ngx.DEBUG, "Subscriber:wait wait end", queue_key, " ", ok, " ", err)
    end
    if not ok then
        return nil, err
    end
    local data
    data, err = dict:lpop(queue_key)
    if debug then
        ngx.log(ngx.DEBUG, "Subscriber:wait dequeue", queue_key, " ", data~=nil, " ", err)
    end
    return data, err
end

---comment close the subscriber
function _M_Subscriber.close(self)
    if self.sema ~= nil then
        local queue_key = self.ukey
        local transmission = self.mgr
        local dict = transmission.dict
        local slots = transmission.slots
        local subs_key = INDEX_PREFIX .. queue_key:sub(1)
        local slot_index, flags = dict:get(subs_key)
        if debug then
            ngx.log(ngx.DEBUG, "Subscriber:close get slot_index ", subs_key, " => ", slot_index, " ", flags)
        end
        if slot_index then
            slots[slot_index] = nil
            if debug then
                ngx.log(ngx.DEBUG, "Subscriber:close unregister semaphore [", slot_index, "]")
            end
            dict:delete(subs_key)
            if debug then
                ngx.log(ngx.DEBUG, "Subscriber:close delete slot_index ", subs_key)
            end
            local length, err0 = dict:rpush(transmission.slots_key, slot_index)
            if debug then
                ngx.log(ngx.DEBUG, "Subscriber:close push available slot_index (", transmission.slots_key, ") ", slot_index, " ", length, " ", err0)
            end
            dict:set(queue_key, S_QUEUE_LOCK, QUEUE_LOCK_TTL)
            if debug then
                ngx.log(ngx.DEBUG, "Subscriber:close lock set ", queue_key)
            end
        end
        self.sema = nil
    end
end

---comment check if the subscriber is valid
---@return boolean valid
function _M_Subscriber.is_valid(self)
    return self.sema ~= nil
end

--#endregion Subscriber


return _M