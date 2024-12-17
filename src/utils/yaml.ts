import * as matter from "gray-matter";
import * as yaml from "js-yaml";

const options = {
  engines: {
    yaml: {
      parse: (input: string) => yaml.load(input) as object,
      stringify: (data: object) => {
        return yaml.dump(data, {
          styles: { "!!null": "empty" },
        });
      },
    },
  },
};

export function readMatter(content: string) {
  return matter(content, options);
}

export function mergeMatter(content: string, data: object) {
  return matter.stringify(content, data, options);
}
