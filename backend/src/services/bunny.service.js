const axios = require('axios');
require("../config/env");

const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'pauta';
const BUNNY_ACCESS_KEY = process.env.BUNNY_ACCESS_KEY;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE || 'cdn.example.com';
// https em produção (CDN). O armazenamento local de desenvolvimento
// (LOCAL_STORAGE_DIR, veja local-storage.service.js) usa http.
const BUNNY_PULL_ZONE_PROTOCOL = process.env.BUNNY_PULL_ZONE_PROTOCOL === 'http' ? 'http' : 'https';
// Endpoint da região BR da Storage API (sobrescrevível para testes locais).
const BUNNY_STORAGE_API_ORIGIN = (
  process.env.BUNNY_STORAGE_API_ORIGIN || 'https://br.storage.bunnycdn.com'
).replace(/\/+$/, '');

if (!BUNNY_ACCESS_KEY) {
  console.error('[bunny] BUNNY_ACCESS_KEY nao definido no .env: uploads vao falhar (para desenvolvimento, use LOCAL_STORAGE_DIR).');
}

function encodeStoragePath(storagePath) {
  return String(storagePath || '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function buildStorageApiUrl(storagePath) {
  return `${BUNNY_STORAGE_API_ORIGIN}/${BUNNY_STORAGE_ZONE}/${encodeStoragePath(storagePath)}`;
}

function buildPublicUrl(storagePath) {
  return `${BUNNY_PULL_ZONE_PROTOCOL}://${BUNNY_PULL_ZONE}/${encodeStoragePath(storagePath)}`;
}

/**
 * Converte a URL publica da CDN no caminho dentro da storage zone.
 * Retorna null para URLs que nao sao da nossa pull zone.
 */
function extractStoragePathFromUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    // host (e nao hostname) porque a pull zone pode vir com porta.
    if (parsed.protocol !== `${BUNNY_PULL_ZONE_PROTOCOL}:` || parsed.host !== BUNNY_PULL_ZONE) {
      return null;
    }

    const storagePath = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent)
      .join('/');

    return storagePath || null;
  } catch {
    return null;
  }
}

/**
 * Uploads a file to BunnyCDN
 * @param {Buffer} fileBuffer - The buffer of the file to upload
 * @param {string} fileName - The name of the file
 * @param {string} folder - The folder path inside the storage zone (e.g., 'Pauta/empresa-abc123/_perfis')
 * @returns {Promise<string>} - The public URL of the uploaded file
 */
async function uploadToBunny(fileBuffer, fileName, folder) {
  const storagePath = `${folder}/${fileName}`;

  try {
    await axios.put(buildStorageApiUrl(storagePath), fileBuffer, {
      headers: {
        'AccessKey': BUNNY_ACCESS_KEY,
        'Content-Type': 'application/octet-stream',
      },
      maxBodyLength: Infinity,
    });

    return buildPublicUrl(storagePath);
  } catch (error) {
    console.error('Error uploading to BunnyCDN:', error?.response?.data || error.message);
    throw new Error('Falha ao fazer upload para a Bunny.net');
  }
}

/**
 * Envia um stream para a Bunny sem carregar o arquivo inteiro em memoria.
 * O stream precisa produzir exatamente `contentLength` bytes.
 */
async function uploadStreamToBunny({ stream, storagePath, contentLength }) {
  await axios.put(buildStorageApiUrl(storagePath), stream, {
    headers: {
      'AccessKey': BUNNY_ACCESS_KEY,
      'Content-Type': 'application/octet-stream',
      'Content-Length': contentLength,
    },
    // Sem redirects o axios usa o http nativo e nao bufferiza o corpo.
    maxRedirects: 0,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return buildPublicUrl(storagePath);
}

async function getBunnyObjectStream(storagePath) {
  try {
    const response = await axios.get(buildStorageApiUrl(storagePath), {
      headers: { 'AccessKey': BUNNY_ACCESS_KEY },
      responseType: 'stream',
    });

    return {
      stream: response.data,
      contentLength: Number(response.headers['content-length']) || null,
      contentType: response.headers['content-type'] || null,
    };
  } catch (error) {
    if (error?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/** Lista os objetos de uma pasta da storage zone (sem recursão). */
async function listBunnyDirectory(folder) {
  const response = await axios.get(`${buildStorageApiUrl(folder)}/`, {
    headers: { 'AccessKey': BUNNY_ACCESS_KEY, 'Accept': 'application/json' },
  });
  return Array.isArray(response.data) ? response.data : [];
}

/** Retorna true quando o arquivo foi removido ou ja nao existia. */
async function deleteFromBunny(storagePath) {
  try {
    await axios.delete(buildStorageApiUrl(storagePath), {
      headers: { 'AccessKey': BUNNY_ACCESS_KEY },
    });
    return true;
  } catch (error) {
    if (error?.response?.status === 404) {
      return true;
    }
    console.error('[bunny] falha ao remover arquivo', {
      storagePath,
      message: error?.response?.data || error.message,
    });
    return false;
  }
}

module.exports = {
  BUNNY_PULL_ZONE,
  BUNNY_PULL_ZONE_PROTOCOL,
  buildPublicUrl,
  extractStoragePathFromUrl,
  uploadToBunny,
  uploadStreamToBunny,
  getBunnyObjectStream,
  listBunnyDirectory,
  deleteFromBunny,
};
