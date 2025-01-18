# PeerJS-Server Signaling Workflow & Protocol

## Workflow



## HTTP API

Endpoints:

- GET `/` - return a JSON to test the server.

  - Response: `application/json`

  ```json
  {
    "name": "PeerJS Server",
    "description": "A server side element to broker connections between PeerJS clients.",
    "website": "https://peerjs.com/"
  }
  ```

This group of methods uses `key` option from config:

- GET `/<key>/id` - return a new user id. required `key` from config.

  - `key`: string

  - Response: `text/plain` uuid generate with '-' format

- GET `/<key>/peers` - return an array of all connected users. required `key` from config. **IMPORTANT:** You should set `allow_discovery` to `true` in config to enable this method. It disabled by default.

  - `key`: string

  - Response: `application/json` an array of all connected users


## WebSocket API

### Endpoints

`/peerjs?key=<key>&id=<id>&token=<token>`

### Protocol

```typescript

enum MessageType {
	OPEN = "OPEN",
	LEAVE = "LEAVE",    // server-side transmission
	CANDIDATE = "CANDIDATE",    // server-side transmission
	OFFER = "OFFER",    // server-side transmission
	ANSWER = "ANSWER",    // server-side transmission
	EXPIRE = "EXPIRE",    // server-side transmission
	HEARTBEAT = "HEARTBEAT",    // server-side record
	ID_TAKEN = "ID-TAKEN",
	ERROR = "ERROR",
}

interface IMessage {
	type: MessageType;
	src?: string;
	dst?: string;
	payload?: string;
}

```

```json

{
    "type":"HEARTBEAT"
}

{
  "type": "OFFER",
  "payload": {
    "sdp": {
      "type": "offer",
      "sdp": "..."
    },
    "type": "data",
    "connectionId": "dc_mgqsb2hzkbe",
    "label": "dc_mgqsb2hzkbe",
    "reliable": false,
    "serialization": "binary"
  },
  "dst": "6481452f-2c1d-4bf3-91b3-58d3c92080f0"
}

{
  "type": "CANDIDATE",
  "payload": {
    "candidate": {
      "candidate": "...",
      "sdpMLineIndex": 0,
      "sdpMid": "0",
      "usernameFragment": "..."
    },
    "type": "data",
    "connectionId": "dc_mgqsb2hzkbe"
  },
  "dst": "6481452f-2c1d-4bf3-91b3-58d3c92080f0"
}
```

#### OPEN

```json
{
  "type": "OPEN"
}
```

PeerJS-Server => Client

send when client connect



#### ID-TAKEN

```json
{
    "type": "ID-TAKEN",
    "payload": { 
        "msg": "ID is taken" 
    }
}
```

PeerJS-Server => Client

send when client connect and token not match



