/**
 * One-time downloader for the local embedding model.
 *
 * Node's global fetch (undici) ignores http(s)_proxy env vars, so we install an
 * EnvHttpProxyAgent explicitly. The proxy is used ONLY here for the download; the
 * running server loads the model from the local cache and never proxies its traffic.
 *
 * Usage:
 *   export https_proxy=
 *   export http_proxy=
 *   node scripts/download-embedding-model.mjs
 */
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";
import path from "path";

const hasProxy =
  process.env.https_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.HTTP_PROXY ||
  process.env.all_proxy ||
  process.env.ALL_PROXY;

if (hasProxy) {
  // EnvHttpProxyAgent only supports HTTP(S) CONNECT proxies (not socks5). Prefer
  // an http:// proxy via https_proxy/http_proxy for the download.
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.log("[download] using proxy from env for model fetch");
} else {
  console.log("[download] no proxy env set; downloading directly");
}

const MODEL =
  process.env.EMBEDDING_MODEL || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const DTYPE = process.env.LOCAL_EMBEDDING_DTYPE || "q8";
const CACHE_DIR = path.resolve(
  process.env.LOCAL_EMBEDDING_CACHE_DIR || ".data/models"
);

const { pipeline, env } = await import("@huggingface/transformers");

env.cacheDir = CACHE_DIR;
env.allowRemoteModels = true;
if (process.env.HF_ENDPOINT) {
  env.remoteHost = process.env.HF_ENDPOINT;
  console.log("[download] HF endpoint:", process.env.HF_ENDPOINT);
}

console.log(`[download] model=${MODEL} dtype=${DTYPE}`);
console.log(`[download] cache dir=${CACHE_DIR}`);

const t0 = Date.now();
const extractor = await pipeline("feature-extraction", MODEL, { dtype: DTYPE });
const out = await extractor(["bonjour le monde", "hello world"], {
  pooling: "mean",
  normalize: true,
});
const vecs = out.tolist();

console.log(
  `[download] OK in ${((Date.now() - t0) / 1000).toFixed(1)}s — dim=${vecs[0].length}`
);
console.log("[download] model cached. Set HF_HUB_OFFLINE=1 to force offline at runtime.");
