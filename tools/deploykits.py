from enum import IntFlag
import hashlib
from json import load as json_load, dump as json_dump
from logging import Logger, getLogger
from os import name as os_name, walk as os_walk, makedirs as os_makedirs, path
import re
from shutil import copyfile
from typing import Dict, List, Optional, Union

from .template import Template
from .variables import Variables

####################################################################################################
### Section File Deployment Components
####################################################################################################

class FileDeploymentMode(IntFlag):
    Default = 0,
    Template = 1,
    Once = 2,

class FileFilter(object):

    def __init__(self, match: str, rename: Optional[str] = None) -> None:
        self.match = re.compile(match)
        self.rename = rename

    def get_file_name(self, source: str) -> Optional[str]:
        m = self.match.match(source)
        if m:
            if self.rename:
                return self.rename.format(*m.groups())
            return source
        return None


class CfgItemFileDeployment(object):

    def __init__(self, source: str, target: str, filter: Optional[Union[str, Dict]] = None, **args) -> None:
        self.source = source
        self.target = target
        self.filter: Optional[FileFilter] = None
        if filter:
            if isinstance(filter, str):
                self.filter = FileFilter(filter)
            else:
                self.filter = FileFilter(**filter)
        self.mode = FileDeploymentMode.Default
        if args.get('once', False):
            self.mode |= FileDeploymentMode.Once
        if args.get('template', False):
            self.mode |= FileDeploymentMode.Template
            self.mode &= ~FileDeploymentMode.Once
        
        



####################################################################################################
### SectionFile Deployment Workflow
####################################################################################################

class DeployKit:

    _WINDOWS = os_name == 'nt'
    FS_CHUNK_SIZE = 1024 * 1024 if _WINDOWS else 64 * 1024

    def __init__(self, record_file: str, vars: Variables, interactively: bool = True, logger: Optional[Logger] = None) -> None:
        self.record_file = record_file
        self.vars = vars
        self.interactively = interactively
        self.logger = logger or getLogger(self.__class__.__name__)
        self.record: Dict[str, str] = {}
        try:
            with open(record_file, 'r') as ifile:
                self.record = json_load(ifile)
        except FileNotFoundError:
            self.logger.warning('can not find record file %s; use empty', record_file)


    def deploy(self, cfg: CfgItemFileDeployment) -> None:
        if path.isdir(cfg.source):
            for dirpath, dirnames, filenames in os_walk(cfg.source):
                rel_dir_path = path.relpath(dirpath, cfg.source)
                for filename in filenames:
                    if rel_dir_path == '.':
                        rel_filename = filename
                    else:
                        rel_filename = path.join(rel_dir_path, filename)
                    source = path.join(dirpath, filename)
                    if cfg.filter:
                        rel_filename = cfg.filter.get_file_name(rel_filename)
                        if not rel_filename:
                            self.logger.debug('file %s not match filter', source)
                            continue
                    target = path.join(cfg.target, rel_filename)
                    filepath = path.dirname(target)
                    if filepath:
                        os_makedirs(filepath, exist_ok=True)
                    self._deploy_file_to_file(source, target, cfg.mode)  
        elif path.isfile(cfg.source):
            filepath, filename = path.split(cfg.target)
            if not filename:
                _, filename = path.split(cfg.source)
                if cfg.filter:
                    filename = cfg.filter.get_file_name(filename)
                    if not filename:
                        self.logger.warning('file %s not match filter', cfg.source)
                        return
                if filepath:
                    os_makedirs(filepath, exist_ok=True)
                target = path.join(cfg.target, filename)
                self._deploy_file_to_file(cfg.source, target, cfg.mode)
            else:
                if filepath:
                    os_makedirs(filepath, exist_ok=True)
                self._deploy_file_to_file(cfg.source, cfg.target, cfg.mode)
        else:
            self.logger.error('invalid source %s', cfg.source)
        self._sync_file_record()
        self.vars.sync()

    

    def _deploy_file_to_file(self, source: str, target: str, mode: FileDeploymentMode) -> bool:
        if mode & FileDeploymentMode.Template:
            template = Template(source)
            for key in template.vars.keys():
                value = self.vars[key]
                if value is None:
                    if self.interactively:
                        value = input(f'please input value for {key}: ')
                        if value:
                            self.vars[key] = value
                        else:
                            self.logger.error('variable %s not found', key)
                            return False
                    else:
                        self.logger.error('variable %s not found', key)
                        return False
            with open(target, 'w') as ofile:
                template.render_into(self.vars, ofile)
            self.logger.info('deployed template %s to %s', source, target)
            return True
        new_hash = None
        if mode & FileDeploymentMode.Once:
            rec_hash = self.record.get(source)
            if rec_hash:
                new_hash = self._get_file_hash(source)
                if rec_hash == new_hash:
                    self.logger.info('file %s not changed', source)
                    return True
        copyfile(source, target)
        self.logger.info('deployed file %s to %s', source, target)
        if new_hash:
            self.record[source] = new_hash
        return True    

    def _deploy_folder_to_folder(self, source_dir: str, target_dir: str, filter: FileFilter, mode: FileDeploymentMode) -> None:
        pass

    def _sync_file_record(self) -> None:
        try:
            with open(self.record_file, 'w') as ofile:
                json_dump(self.record, ofile)
        except Exception as e:
            self.logger.error('failed to write record file %s: %s', self.record_file, e)
        
    @staticmethod
    def _get_file_hash(target: str) -> str:
        with open(target, 'rb', buffering=False) as ifile:
            hasher = hashlib.sha256()
            while chunk := ifile.read(DeployKit.FS_CHUNK_SIZE):
                hasher.update(chunk)
            return hasher.hexdigest()

####################################################################################################
####################################################################################################
####################################################################################################


def main(cfg_file: str, vars_file: str, rec_file: str) -> None:
    cfg: List[CfgItemFileDeployment] = []
    with open(cfg_file, 'r') as ifile:
        data = json_load(ifile)
        for item in data:
            cfg.append(CfgItemFileDeployment(**item))

    vars = Variables(vars_file)
    vars.sync()
    deploy_kit = DeployKit(rec_file, vars)
    for item in cfg:
        deploy_kit.deploy(item)



if __name__ == '__main__':
    import logging
    import sys
    from os import environ
    logging.basicConfig(level=logging.DEBUG)
    ROOT, _ = path.split(sys.argv[0])
    WORKSPACE = 'build'
    VARS_FILE = path.join(WORKSPACE, 'deploy.vars.json')
    REC_FILE = path.join(WORKSPACE, 'deploy.record.json')
    CFG_FILE = path.join(ROOT, 'openresty-deploy-mapping.json')
    main(CFG_FILE, VARS_FILE, REC_FILE)