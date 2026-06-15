import type { UriCsvRow } from "@/lib/storage";

const ASSET_URI_PATTERN = /asset:\/\/(img|text|audio|video)\/[a-zA-Z0-9_-]+/g;

export function buildAssetMap(uriRows: UriCsvRow[]): Record<string, string> {
  const map: Record<string, string> = {};

  for (const row of uriRows) {
    if (!row.url) continue;
    map[row.uri] = row.url;
    map[`asset://${row.type}/${row.name}`] = row.url;
  }

  return map;
}

export function buildAssetMapFromAssets(
  assets: { uri: string; url: string; name: string; type: string }[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const asset of assets) {
    if (!asset.url) continue;
    map[asset.uri] = asset.url;
    map[`asset://${asset.type}/${asset.name}`] = asset.url;
  }
  return map;
}

export function toAbsoluteAssetMap(
  assetMap: Record<string, string>,
  origin: string
): Record<string, string> {
  const absolute: Record<string, string> = {};
  for (const [uri, url] of Object.entries(assetMap)) {
    absolute[uri] = url.startsWith("http") ? url : `${origin}${url}`;
  }
  return absolute;
}

export function resolveAssetUris(
  content: string,
  assetMap: Record<string, string>
): string {
  let result = content;

  for (const [uri, url] of Object.entries(assetMap)) {
    result = result.replaceAll(uri, url);
  }

  result = result.replace(ASSET_URI_PATTERN, (match) => assetMap[match] || match);

  return result;
}

export function buildAssetResolverScript(assetMap: Record<string, string>): string {
  const mapJson = JSON.stringify(assetMap);

  return `<script>
(function() {
  var ASSET_MAP = ${mapJson};
  function resolveUri(url) {
    if (!url || typeof url !== "string") return url;
    if (ASSET_MAP[url]) return ASSET_MAP[url];
    return url;
  }
  function patchLoader() {
    if (typeof Phaser === "undefined" || !Phaser.Loader || !Phaser.Loader.LoaderPlugin) return false;
    var proto = Phaser.Loader.LoaderPlugin.prototype;
    ["image", "audio", "video", "spritesheet", "atlas"].forEach(function(method) {
      if (!proto[method]) return;
      var original = proto[method];
      proto[method] = function(key, url) {
        var args = Array.prototype.slice.call(arguments, 2);
        var resolved = resolveUri(url);
        return original.apply(this, [key, resolved].concat(args));
      };
    });
    return true;
  }
  var attempts = 0;
  var timer = setInterval(function() {
    attempts++;
    if (patchLoader() || attempts > 200) clearInterval(timer);
  }, 25);
})();
</script>`;
}

export function injectAssetResolver(html: string, resolverScript: string): string {
  if (html.includes("</head>")) {
    return html.replace("</head>", `${resolverScript}\n</head>`);
  }
  return resolverScript + html;
}
