from typing import Dict, Optional, Set, Union
from json import load as json_load, dump as json_dump

####################################################################################################
### Section Variables
####################################################################################################

class Variables(object):

    def __init__(self, path: str, sys: Optional[Dict[str, Union[str, int, float, bool]]] = None):
        self.path = path
        self.sys = sys or {}
        self.data = {}
        self.modified: Set[str] = set()
        self.pattern = None

    def sync(self):
        try:
            data = None
            with open(self.path, 'r') as f:
                data = json_load(f)
        except FileNotFoundError:
            data = {}
        for key in self.modified:
            new_value = Variables.plain_get(self.data, key)
            Variables.plain_set(data, key, new_value)
        try:
            with open(self.path, 'w') as f:
                json_dump(data, f, indent=4)
        finally:
            self.modified.clear()
            self.data = data

    def __getitem__(self, key: str) -> Optional[Union[str, int, float, bool]]:
        if key in self.sys:
            return self.sys[key]
        return Variables.plain_get(self.data, key)
    
    def __setitem__(self, key: str, value: Union[str, int, float, bool]):
        if key in self.sys:
            self.sys[key] = value
            return
        Variables.plain_set(self.data, key, value)
        self.modified.add(key)

    def __repr__(self) -> str:
        return f'<Variables path={self.path} sys={self.sys} data={self.data}>'

    @staticmethod
    def plain_set(data: Dict, key: str, value: Union[str, int, float, bool]) -> None:
        keys = key.split('.')
        p = data
        for part in keys[:-1]:
            next_p = p.get(part)
            if next_p is None:
                next_p = {}
                p[part] = next_p
            p = next_p
        part = keys[-1]
        p[part] = value

    @staticmethod
    def plain_get(data: Dict, key: str) -> Union[str, int, float, bool]:
        keys = key.split('.')
        p = data
        for part in keys:
            p = p.get(part)
            if p is None:
                return None
        return p