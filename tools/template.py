from io import TextIOBase
from typing import Dict, List, Optional, Union
from .variables import Variables

####################################################################################################
### Section Template ###############################################################################
####################################################################################################

class Template(object):

    class Var(object):

        def __init__(self, key: str, kind: int) -> None:
            self.key = key
            self.kind = kind

    PATTERN = r'{{\s*("?[a-zA-Z_][\w.-]*"?)\s*}}'
    PATTERN_RE = None

    def __init__(self, template_file: Optional[Union[TextIOBase, str]] = None, template: Optional[str] = None) -> None:
        from re import compile as re_compile
        if Template.PATTERN_RE is None:
            Template.PATTERN_RE = re_compile(Template.PATTERN)
        self.parts: List[Union[str, Template.Var]] = []
        self.vars: Dict[str, int] = {}
        if template_file:
            if isinstance(template_file, str):
                with open(template_file, 'r') as f:
                    while line := f.readline():
                        self._parse(line)
            else:
                while line := template_file.readline():
                    self._parse(line)
        elif template:
            self._parse(template)
        else:
            raise ValueError('template_file or template must be specified')

    def _parse(self, chunk: str):
        last = 0
        for m in Template.PATTERN_RE.finditer(chunk):
            key = m.group(1)
            kind = 0
            a = key.startswith('"')
            b = key.endswith('"')
            if a and b:
                kind = 1
                key = key[1:-1]
            elif (not a) and (not b):
                kind = 0
            else:
                raise ValueError(f'invalid key {key}')
            i = m.start()
            prefix = chunk[last:i]
            if prefix:
                self.parts.append(prefix)
            self.parts.append(Template.Var(key, kind))
            self.vars[key] = self.vars.get(key, 0) + 1
            last = m.end()
        suffix = chunk[last:]
        if suffix:
            self.parts.append(suffix)

    def render_into(self, variables: Variables, output: TextIOBase) -> bool:
        from shlex import quote
        cache: Dict[str, str] = {}
        for var in self.vars.keys():
            value = variables[var]
            if value is None:
                return False
            cache[var] = str(value)
        for part in self.parts:
            if isinstance(part, str):
                output.write(part)
            else:
                value = cache[part.key]
                if part.kind == 1:
                    value = quote(value)
                output.write(value)
        output.flush()
        return True
    

####################################################################################################
####################################################################################################
####################################################################################################

if __name__ == '__main__':
    from argparse import ArgumentParser
    import sys
    from os import path
    
    ROOT, _ = path.split(sys.argv[0])
    WORKSPACE = 'build'
    VARS_FILE = path.join(WORKSPACE, 'deploy.vars.json')
    INPUT_FILE = path.join(ROOT, 'buildcfg.t.sh')
    OUTPUT_FILE = 'buildcfg.sh'
    parser = ArgumentParser(description='Template')
    parser.add_argument('-i', '--input', dest='input', help='input template file', default=INPUT_FILE)
    parser.add_argument('-o', '--output', dest='output', help='output file', default='@build.openresty')
    parser.add_argument('-v', '--variables-file', dest='vars_file', help='variables file', default=VARS_FILE)
    parser.add_argument('-V', '--variable', dest='vars', help='variable like \"key=value\"', nargs='*')
    args = parser.parse_args()
    sys_vars = {}
    if args.vars:
        for var in args.vars:
            key, value = var.split('=', 1)
            sys_vars[key] = value
    variables = Variables(args.vars_file, sys_vars)
    variables.sync()
    input_file = args.input
    output_file = args.output
    if output_file.startswith('@'):
        key = output_file[1:]
        output_dir = variables[key]
        output_file = path.join(output_dir, OUTPUT_FILE)
    print(input_file, '==>', output_file)
    template = Template(input_file)
    for key in template.vars.keys():
        value = variables[key]
        if value is None:
            value = input(f'please input value for {key}: ')
            if value:
                variables[key] = value
    variables.sync()
    with open(output_file, 'w') as output:
        template.render_into(variables, output)