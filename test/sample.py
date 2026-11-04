def load_config(path):
    with open(path) as f:
        return parse(f.read())


def parse(text):
    result = {}
    for line in text.splitlines():
        key, _, value = line.partition("=")
        result[key.strip()] = value.strip()
    return result


def helper_one():
    return 1


def helper_two():
    return 2


def helper_three():
    return 3


def main():
    config = load_config("app.cfg")
    print(config)
