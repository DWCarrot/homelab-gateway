local ffi = require "ffi"

ffi.cdef[[
    int get_nprocs(void);
    int get_nprocs_conf(void); 
]]

local libc = ffi.load("c")

local _M = { version = "0.1" }

function _M.get_nprocs()
    return libc.get_nprocs()
end

function _M.get_nprocs_conf()
    return libc.get_nprocs_conf()
end

return _M