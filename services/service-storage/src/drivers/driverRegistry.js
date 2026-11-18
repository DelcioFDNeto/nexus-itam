// services/service-storage/src/drivers/driverRegistry.js
// =============================================================================
// Registro Unificado dos 3 Drivers Híbridos de Storage VPS
// =============================================================================

import { decryptVaultCredentials } from '../../../shared/security.js';
import { createSftpDriver } from './sftpDriver.js';
import { createAgentNodeDriver } from './agentNodeDriver.js';
import { createS3OrWebDavDriver } from './s3Driver.js';

export function resolveStorageDriver(connection) {
  if (!connection) {
    const err = new Error('Conexão VPS não configurada para esta empresa.');
    err.code = 'VPS_NOT_CONFIGURED';
    err.statusCode = 412;
    throw err;
  }

  let credentials = {};
  const cipher = connection.encrypted_credentials || connection.encryptedCredentials;
  if (cipher) {
    try {
      credentials = decryptVaultCredentials(cipher) || {};
    } catch {
      credentials = {};
    }
  }

  const providerType = String(connection.provider_type || connection.providerType || 'sftp').toLowerCase();
  if (providerType === 'agent_node') {
    return createAgentNodeDriver(connection, credentials);
  }
  if (providerType === 's3' || providerType === 'webdav') {
    return createS3OrWebDavDriver(connection, credentials);
  }
  return createSftpDriver(connection, credentials);
}
