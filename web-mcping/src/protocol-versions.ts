const VERSIONS_FILE_URL = "https://raw.githubusercontent.com/Bixilon/Minosoft/master/src/main/resources/assets/minosoft/mapping/versions.json";

export interface ProtocolPacket {
    play: string[];
    [key: string]: string[];
}

export interface ProtocolPackets extends ProtocolPacketsRaw {
    c2s: ProtocolPacket;
    s2c: ProtocolPacket;
}

export interface ProtocolElement extends ProtocolElementRaw {
    packets: ProtocolPackets
}

interface ProtocolPacketsRaw {
    c2s: ProtocolPacket | string[];
    s2c: ProtocolPacket | string[];
}

interface ProtocolElementRaw {
    name: string;
    protocol_id?: number;
    packets: number | ProtocolPacketsRaw;
    type?: string;
}

interface ProtocolVersionsRaw {
    [key: string]: ProtocolElementRaw;
}


function rectifyPackets(packets: ProtocolPacketsRaw): ProtocolPackets {
    if (packets.c2s instanceof Array) {
        packets.c2s = {
            play: packets.c2s
        } as ProtocolPacket;
    }
    if (packets.s2c instanceof Array) {
        packets.s2c = {
            play: packets.s2c
        } as ProtocolPacket;
    }
    return packets as ProtocolPackets;
}

export function getVersions(): Promise<ProtocolElement[]> {
    return fetch(VERSIONS_FILE_URL)
        .then(response => response.json())
        .then((data: ProtocolVersionsRaw) => {
            const versions: ProtocolElement[] = [];
            for (const key in data) {
                const element = data[key] as ProtocolElementRaw;
                if (typeof element.packets === "number") {
                    const refKey = element.packets.toString();
                    const refElement = data[refKey] as ProtocolElementRaw;
                    element.packets = rectifyPackets(refElement.packets as ProtocolPacketsRaw);
                } else {
                    rectifyPackets(element.packets);
                }
                if (element.protocol_id !== undefined) {
                    versions.push(element as ProtocolElement);
                }
            }
            return versions;
        })
        .then((list) => list.reverse());
}