from test.moved import helper_three
from test.generated import VERSION


def load_config(path):
    with open(path) as f:
        return parse(f.read())


def parse(text):
    result = {}
    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        result[key.strip()] = value.strip()
    return result


def helper_one():
    return 1


def helper_two():
    return 2


def main():
    config = load_config("app.cfg")
    config["version"] = VERSION
    print(config)
