local CFGDATA = require "CFGDATA"
local ngx = require "ngx"
local new_tab = require "table.new"
local clear_tab = require "table.clear"
local json = require "cjson.safe"
local Semaphore = require "ngx.semaphore"

local Signaling = { version = "0.0.1" }
local mt = { __index = Signaling }

function Signaling.new()
    local instance = {
        max_peers = CFGDATA.signaling.max_peers,
        max_timeout_s = CFGDATA.signaling.max_timeout_s,
        peers = new_tab(0, CFGDATA.signaling.max_peers),
        peers_count = 0
    }
    return setmetatable(instance, mt)
end


---comment
---@param self table Signaling
---@param channel_id string
---@param peer_id string
---@param data any
---@return table? peer_info {channel_id: string, primary_id: string, primary_data: any, secondary_id: string, secondary_data: any}
---@return boolean is_primary
local function get_peer(self, channel_id, peer_id, data)
    -- TODO: thread safe
    local peer_info = self.peers[channel_id]
    if peer_info == nil then
        ngx.log(ngx.DEBUG, "Signaling:get_peer: create channel_id=", channel_id)
        if self.peers_count >= self.max_peers then
            return nil, true
        end
        peer_info = {
            channel_id = channel_id,
            primary_id = peer_id,
            primary_data = data,
            secondary_id = nil,
            secondary_data = nil,
            sema = Semaphore.new(0)
        }
        self.peers_count = self.peers_count + 1
        self.peers[channel_id] = peer_info
        return peer_info, true
    else
        return peer_info, false
    end
end

---comment
---@param self table Signaling
---@param peer_info table PeerInfo
local function rmv_peer(self, peer_info)
    local channel_id = peer_info.channel_id
    ngx.log(ngx.DEBUG, "Signaling:rmv_peer: remove channel_id=", channel_id)
    if self.peers[channel_id] ~= nil then
        self.peers[channel_id] = nil
        self.peers_count = self.peers_count - 1
    end
end

local function json_check(raw, peer_id)
    local data, err = json.decode(raw)
    if not data then
        return nil, err
    end
    if type(data) ~= "table" then
        return nil, "data is not a object"
    end
    local _id = data["id"]
    if _id ~= peer_id then
        return nil, "id not match"
    end
    local offer = data["offer"]
    local answer = data["answer"]
    if offer ~= nil and answer == nil then
        local icecandidates = data["icecandidates"]
        if not (icecandidates ~= nil and type(icecandidates) == "table" and #icecandidates > 0) then
            return nil, "icecandidates is not a array"
        end
        return "offer", nil
    end
    if offer == nil and answer ~= nil then
        local icecandidates = data["icecandidates"]
        if not (icecandidates ~= nil and type(icecandidates) == "table" and #icecandidates > 0) then
            return nil, "icecandidates is not a array"
        end
        return "answer", nil
    end
    return nil, "offer and answer are not exclusive"
end

---comment
---@param self table Signaling
---@param channel_id string
---@param peer_id string
---@param data string
---@param timeout number?
---@return any response
---@return number code
function Signaling.serve(self, channel_id, peer_id, data, timeout)
    ngx.log(ngx.INFO, "Signaling:serve start: channel_id=", channel_id, " peer_id=", peer_id, " data=[", #data, "] timeout=", timeout)
    local ret, err = json_check(data, peer_id)
    if ret == nil then
        return err, ngx.HTTP_BAD_REQUEST
    end
    local peer_info, is_primary = get_peer(self, channel_id, peer_id, data)
    if peer_info == nil then
        return "", ngx.HTTP_SERVICE_UNAVAILABLE
    end
    ngx.log(ngx.DEBUG, "Signaling:serve normalize: channel_id=", channel_id, " peer_id=", peer_id, " data=@", ret, " is_primary=", is_primary)
    if is_primary then
        if ret ~= "offer" then
            rmv_peer(self, peer_info)
            return "primary peer must send offer", ngx.HTTP_BAD_REQUEST
        end
        peer_info.primary_data = data
        if timeout == nil or timeout <= 0 or timeout > self.max_timeout_s then
            timeout = self.max_timeout_s
        end
        ngx.log(ngx.INFO, "Signaling:serve: waiting for secondary peer: ", timeout)
        ret, err = peer_info.sema:wait(timeout)
        local resp = peer_info.secondary_data
        ngx.log(ngx.INFO, "Signaling:serve: waiting end: ", ret)
        if not ret then
            rmv_peer(self, peer_info)
            return err, ngx.HTTP_REQUEST_TIMEOUT
        end
        if resp == nil then
            rmv_peer(self, peer_info)
            return "secondary peer not found", ngx.HTTP_INTERNAL_SERVER_ERROR
        end
        rmv_peer(self, peer_info)
        return resp, ngx.HTTP_OK
    else
        if ret == "offer" then
            ngx.log(ngx.INFO, "Signaling:serve: secondary peer send offer; request rollback")
            local resp = peer_info.primary_data
            if not resp then
                return "primary peer not found", ngx.HTTP_INTERNAL_SERVER_ERROR
            end
            return resp, ngx.HTTP_OK
        else
            ngx.log(ngx.INFO, "Signaling:serve: secondary peer send answer; transfer")
            peer_info.secondary_data = data
            peer_info.sema:post(1)
            return "{}", ngx.HTTP_OK
        end
    end
end

Signaling.instance = Signaling.new()

return Signaling
