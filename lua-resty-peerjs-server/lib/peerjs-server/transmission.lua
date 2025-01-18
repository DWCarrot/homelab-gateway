--- interface of Transmission and Subscriber ---

--#region Transmission

local _M = {

}

local mt = { __index = _M }

---comment subscribe to a key
---@param key string key to subscribe; should not be nil or empty
---@return table? subscriber Subscriber; nil if err
---@return any? err error message
function _M.subscribe(self, key)
    local subscriber
    local err
    return subscriber, err
end


---comment publish data to a key
---@param key string key to publish; should not be nil or empty
---@param data string data to publish; should not be nil or empty
---@return boolean ok
---@return any? err error message
function _M.publish(self, key, data)
    local ok
    local err
    return ok, err
end


---comment get subscribers of all key
---@param self table Transmission
---@param filter function? (key: string) -> string? filter function to filter subscribers
---@return table
function _M.get_subscribers(self, filter)
    local subscribers = {}
    return subscribers
end


--#endregion Transmission

--#region Subscriber

local _M_Subscriber = {

}

local mt_Subscriber = { __index = _M_Subscriber }

---comment
---@param timeout number?
---@return string? data; nil if timeout or error
---@return any? err error message; "timeout" if timeout, "closed" if closed, or other error message
function _M_Subscriber.wait(self, timeout)
    local data
    local err
    return data, err
end

---comment close the subscriber
function _M_Subscriber.close(self)
    
end

---comment check if the subscriber is valid
---@return boolean valid
function _M_Subscriber.is_valid(self)
    return false
end

--#endregion Subscriber

return _M