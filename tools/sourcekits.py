from abc import ABC, abstractmethod
from http.client import HTTPMessage, HTTPResponse
from json import loads as json_loads, load as json_load, dump as json_dump
from logging import Logger, getLogger
from os import makedirs, mkdir, path, remove, name as os_name
from typing import Callable, Dict, List, Literal, Optional, Tuple
from urllib.request import ProxyHandler, Request, build_opener
from .variables import Variables



####################################################################################################
### Source Download Components #####################################################################
####################################################################################################


### Section Download Components: Configurations

class CfgItemValidate(object):

    def __init__(self, type: Literal['sha256', 'sha1', 'md5', 'pgp'], data: Optional[str] = None, url: Optional[str] = None, key: Optional[str] = None) -> None:
        self.type = type
        self.data = data
        self.url = url
        self.pgp_key = key

class CfgItemDownload(object):

    def __init__(self, url: str, format: Literal["tgz", "zip"], file: Optional[str] = None, validate: Optional[Dict] = None) -> None:
        self.url = url
        self.file = file
        self.format = format
        self.validate = CfgItemValidate(**validate) if validate else None


### Source Download and Extract Components: Downloader #############################################

class Downloader(object):

    _WINDOWS = os_name == 'nt'
    BUFFER_SIZE = 8192
    FS_BUFFER_SIZE = 1024 * 1024 if _WINDOWS else 64 * 1024
    DISPLAY_INTERVAL = 5
    
    def __init__(self, root: str, user_agent: Optional[str] = 'Wget/1.21.3', proxies: Optional[Dict[str, str]] = None, logger: Optional[Logger] = None) -> None:
        self.root = path.abspath(root)
        if proxies:
            proxy_handler = ProxyHandler(proxies)
            self.opener = build_opener(proxy_handler)
        else:
            self.opener = build_opener()
        if user_agent:
            for i in range(len(self.opener.addheaders)):
                header_name, _ = self.opener.addheaders[i]
                if header_name == 'User-Agent':
                    self.opener.addheaders[i] = ('User-Agent', user_agent)
                    break
        self.logger = logger or getLogger(self.__class__.__name__)

    def content(self, url: str) -> Optional[bytes]:
        try:
            req = Request(url)
            with self.opener.open(req) as resp:
                content = None
                while data := resp.read(Downloader.BUFFER_SIZE):
                    if content:
                        raise ValueError('content too large')
                    content = data
                return content
        except Exception as e:
            self.error('Failed to download content %s: %s', url, e)
            return None

    def download_and_validate(self, item: CfgItemDownload) -> Optional[str]:
        filepath = self.download(item.url, item.file)
        if not filepath:
            return None
        if item.validate:
            if not self._validate_general(filepath, item.validate):
                self.logger.error('Remove %s for validate failure', filepath)
                remove(filepath)
                return None
        return filepath

    def download(self, url: str, file: Optional[str] = None) -> Optional[str]:
        from time import time
        try:
            req = Request(url)
            with self.opener.open(req) as resp:
                resp: HTTPResponse
                if not file:
                    file = Downloader.parse_filename(resp.headers)
                if not file:
                    raise ValueError(f'failed to get filename; {resp.headers.as_string()}')
                filepath = path.abspath(path.join(self.root, file))
                if not filepath.startswith(self.root):
                    raise ValueError(f'access denied to {filepath} with {file}')
                makedirs(self.root, exist_ok=True)
                with open(filepath, 'wb') as ofile:
                    content_length = Downloader.parse_content_length(resp.headers)
                    if content_length:
                        self.logger.info('Downloading %s to %s as %s [%d]', url, filepath, file, content_length)
                    else:
                        self.logger.info('Downloading %s to %s as %s', url, filepath, file)
                    read = 0
                    last_time = 0
                    last_display = 0
                    while chunk := resp.read(Downloader.BUFFER_SIZE):
                        ofile.write(chunk)
                        read += len(chunk)
                        now = time()
                        if now - last_time > Downloader.DISPLAY_INTERVAL:
                            last_time = now
                            last_display = read
                            if content_length:
                                self.logger.info('Downloaded %.2f%%', 100 * read / content_length)
                            else:
                                self.logger.info('Downloaded %d bytes', read)
                    if last_display != read:
                        if content_length:
                            self.logger.info('Downloaded %.2f%%', 100 * read / content_length)
                        else:
                            self.logger.info('Downloaded %d bytes', read)
                return filepath
        except Exception as e:
            self.logger.error('Failed to download %s: %s', url, e)
            return None
    
    def validate_hash(self, filepath: str, algo: Literal["sha256", "sha1", "md5"], hash: str) -> Optional[bool]:
        import hashlib
        try:
            hasher = hashlib.new(algo)
            with open(filepath, 'rb', buffering=False) as ifile:
                while chunk := ifile.read(Downloader.FS_BUFFER_SIZE):
                    hasher.update(chunk)
            hash_value = hasher.hexdigest()
            return hash == hash_value
        except Exception as e:
            self.logger.error('Failed to validate %s: %s', filepath, e)
            return None
        
    def _validate_general(self, filepath: str, validate: CfgItemValidate) -> Optional[bool]:
        if validate.type in ('sha256', 'sha1', 'md5'):
            _data = validate.data
            if not _data:
                if not validate.url:
                    self.logger.error('Failed to validate %s: no data or url in %s', filepath, validate)
                    return None
                content = self.content(validate.url)
                if not content:
                    self.logger.error('Failed to validate %s: can not download data', filepath)
                    return None
                _data = content.split()[0].decode('utf-8')
            return self.validate_hash(filepath, validate.type, _data)
        if validate.type in ('pgp', ):
            return True #TODO validate pgp
        return None
                

    @staticmethod  
    def parse_filename(headers: HTTPMessage) -> Optional[str]:
        content_disposition = headers.get('Content-Disposition')
        if content_disposition:
            parts = content_disposition.split(';')
            if len(parts) > 1:
                first = parts[0].strip()
                if first.lower() == 'attachment':
                    for part in parts[1:]:
                        key, value = part.strip().split('=')
                        if key == 'filename':
                            if value.startswith('"') and value.endswith('"'):
                                return json_loads(value)
                            else:
                                return value
        return None
    
    @staticmethod
    def parse_content_length(headers: HTTPMessage) -> Optional[int]:
        content_length = headers.get('Content-Length')
        if content_length:
            try:
                return int(content_length)
            except ValueError:
                pass
        return None
    


####################################################################################################
### Source Extract Components ######################################################################
####################################################################################################

class Extractor(ABC):

    REGISTERED_EXTRACTORS: Dict[str, Callable[[str],'Extractor']] = {}

    def __init__(self, root: str, logger: Optional[Logger] = None) -> None:
        self.root = path.abspath(root)
        self.logger = logger or getLogger(self.__class__.__name__)

    @abstractmethod
    def extract(self, target: str) -> Optional[str]:
        return None
    
    def folder_name(self, target: str, *exts: List[str]) -> str:
        filename = path.basename(target)
        for ext in exts:
            if filename.endswith(ext):
                return filename[:-len(ext)]
        return filename + '.extracted'
    
    @staticmethod
    def get(root: str, format: str) -> Optional['Extractor']:
        constructor = Extractor.REGISTERED_EXTRACTORS.get(format)
        if constructor:
            return constructor(root)
        return None
    

class TarExtractor(Extractor):

    def __init__(self, root: str, format: Literal["gz","bz2","xz"], logger: Optional[Logger] = None) -> None:
        super().__init__(root, logger)
        self.format = f'r:{format}'

    def extract(self, target: str) -> Optional[str]:
        from tarfile import TarFile
        try:
            with TarFile.open(target, self.format) as tar:
                folder = None
                for member in tar:
                    if member.isdir() and folder is None:
                        folder = member.path
                    else:
                        if folder is None:
                            break
                        if not member.path.startswith(folder):
                            folder = None
                            break
                if folder:
                    output = path.join(self.root, folder)
                    folder = self.root
                else:
                    folder_name = self.folder_name(target, '.tar.gz', '.tgz', '.tar.bz2', '.tbz', '.tar.xz', '.txz')
                    output = path.join(self.root, folder_name)
                    folder = output
                    self.logger.warning('Unwrapped tar file; wrap with folder %s', folder_name)
                    try:
                        mkdir(target)
                    except FileExistsError:
                        pass
                self.logger.info('Extracting %s to %s', target, folder)
                tar.extractall(folder)
                self.logger.info('Extracted %s as %s', target, output)
                return output
        except Exception as e:
            self.logger.error('Failed to extract %s: %s', target, e)
            return None
        
Extractor.REGISTERED_EXTRACTORS['tgz'] = lambda root: TarExtractor(root, 'gz')
        

class ZipExtractor(Extractor):

    def extract(self, target: str) -> Optional[str]:
        from zipfile import ZipFile
        try:
            with ZipFile(target) as zip:
                folder = None
                for member in zip.infolist():
                    if member.is_dir() and folder is None:
                        folder = member.filename
                    else:
                        if folder is None:
                            break
                        if not member.filename.startswith(folder):
                            folder = None
                            break
                if folder:
                    if folder.endswith('/'):
                        folder = folder[:-1]
                    output = path.join(self.root, folder)
                    folder = self.root
                else:
                    folder_name = self.folder_name(target, '.zip')
                    output = path.join(self.root, folder_name)
                    folder = output
                    self.logger.warning('Unwrapped zip file; wrap with folder %s', folder_name)
                    try:
                        mkdir(target)
                    except FileExistsError:
                        pass
                self.logger.info('Extracting %s to %s', target, folder)
                zip.extractall(folder)
                self.logger.info('Extracted %s as %s', target, output)
                return output
        except Exception as e:
            self.logger.error('Failed to extract %s: %s', target, e)
            return None
        
Extractor.REGISTERED_EXTRACTORS['zip'] = lambda root: ZipExtractor(root)



####################################################################################################
### Section Download Workflow
####################################################################################################


class SourceKit(object):

    def __init__(self, vars: Variables, downloader: Downloader, logger: Optional[Logger] = None) -> None:
        self.vars = vars
        self.downloader = downloader
        self.logger = logger or getLogger(self.__class__.__name__)
        self.field_final = 'build'
        self.field_download_cache = '_dlcache'
        self.vars.sync()

    def download_and_extract(self, key: str, cfg: CfgItemDownload) -> Optional[str]:
        folder = self._read_build_info(key)
        if folder and path.isdir(folder):
            self.logger.info('download_and_extract skip %s: exist %s', key, folder)
            return folder
        url, downloaded = self._read_cache_info(key)
        if url and downloaded and cfg.url == url and path.isfile(downloaded):
            self.logger.info('download_and_extract skip download %s: exist %s', key, downloaded)
        else:
            self.logger.info('download_and_extract download begin %s: %s', key, cfg.url)
            downloaded = self.downloader.download_and_validate(cfg)
            if not downloaded:
                self.logger.error('download_and_extract download failed %s: %s', key, cfg.url)
                return None
            self._write_cache_info(key, cfg.url, downloaded)
            self.logger.info('download_and_extract download end %s: %s', key, downloaded)
        self.logger.info('download_and_extract extract begin %s: %s', key, downloaded)
        extractor = Extractor.get(self.downloader.root, cfg.format)
        if not extractor:
            self.logger.error('download_and_extract extract failed: unable to get extractor \"%s\" for %s', cfg.format, key)
            return None
        folder = extractor.extract(downloaded)
        if not folder:
            self.logger.error('download_and_extract extract failed %s', key)
            return None
        self._write_build_info(key, folder)
        self.logger.info('download_and_extract extract end %s: %s', key, folder)
        self.vars.sync()
        return folder
        
    def _load_cache_record(self) -> None:
        try:
            with open(self.cache_rec_file, 'r') as ifile:
                self.cache_rec = json_loads(ifile)
        except FileNotFoundError:
            self.logger.warning('can not find cache record file %s; use empty', self.cache_rec_file)
    
    def _save_cache_record(self) -> None:
        try:
            with open(self.cache_rec_file, 'w') as ofile:
                json_dump(self.vars, ofile)
        except Exception as e:
            self.logger.error('failed to write cache record file %s: %s', self.cache_rec_file, e)

    def _write_build_info(self, key: str, value: str):
        self.vars[f'{self.field_final}.{key}'] = value

    def _read_build_info(self, key: str) -> Optional[str]:
        return self.vars[f'{self.field_final}.{key}']

    def _write_cache_info(self, key: str, url: str, downloaded: str):
        self.vars[f'{self.field_download_cache}.{key}'] = f'{url};{downloaded}'

    def _read_cache_info(self, key: str) -> Tuple[Optional[str], Optional[str]]:
        s = self.vars[f'{self.field_download_cache}.{key}']
        if not s:
            return None, None
        parts = s.split(';')
        url = parts[0]
        downloaded = parts[1]
        return url, downloaded
    

####################################################################################################
####################################################################################################
####################################################################################################


def main(cfg_file: str, vars_file: str, workspace: str = 'build', proxies: Optional[Dict[str, str]] = None):    
    downloads_cfg: Dict[str, CfgItemDownload] = {}
    with open(cfg_file, 'r') as ifile:
        data = json_load(ifile)
        for key, item_raw in data.items():
            item = CfgItemDownload(**item_raw)
            downloads_cfg[key] = item
    if downloads_cfg:
        vars_writer = Variables(vars_file)
        downloader = Downloader(workspace, proxies=proxies)
        kit = SourceKit(vars_writer, downloader)
        for key, item in downloads_cfg.items():
            kit.download_and_extract(key, item)


if __name__ == '__main__':
    import logging
    import sys
    from os import environ
    logging.basicConfig(level=logging.DEBUG)
    ROOT, _ = path.split(sys.argv[0])
    WORKSPACE = 'build'
    VARS_FILE = path.join(WORKSPACE, 'deploy.vars.json')
    CFG_FILE = path.join(ROOT, 'openresty-build-downloads.json')
    proxies = {}
    proxy = environ.get('http_proxy')
    if not proxy:
        proxy = environ.get('HTTP_PROXY')
    if proxy:
        proxies['http'] = proxy
    proxy = environ.get('https_proxy')
    if not proxy:
        proxy = environ.get('HTTPS_PROXY')
    if proxy:
        proxies['https'] = proxy

    main(CFG_FILE, VARS_FILE, WORKSPACE, proxies)
    