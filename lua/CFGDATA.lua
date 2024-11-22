return {
    version = "0.0.1",
    
    --#region [config for resty.dns.resolver]
    dns = {
        nameservers = {
            "192.168.31.1",
        },
        retrans = 5,
        timeout = 2000,
        cache = 60 * 60
    },
    --#endregion

    --#region [config for wsproxy]
    wsproxy = {
        ws_timeout = 2000,
        ws_max_payload_len = 65535,
        rs_timeout = 1000,
        rs_recv_buf_size = 16384,
        blacklist = {
            "127.0.0.1/8",
            "::1/128",
        }
    }
}