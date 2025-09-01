// Standardized SSH Configuration Constants
// This file contains unified SSH polling and connection parameters
// to prevent conflicts across different components

export const SSH_CONFIG = {
  // SSH Connection Parameters
  username: 'pinakasupport',
  keyPath: '/home/pinakasupport/.pinaka_wd/key/ps_key.pem',
  
  // Polling Constants
  POLL_DELAY_MS: 120000,       // 90s (1.5 minutes) delay to allow node reboot
  POLL_INTERVAL_MS: 5000,     // Poll every 5 seconds
  POLL_MAX_POLLS: 120,        // Max ~10 minutes after delay (120 * 5s = 600s)
  
  // Timeout Constants (in seconds)
  CONNECTION_TIMEOUT: 10,     // SSH connection timeout
  BANNER_TIMEOUT: 30,         // SSH banner timeout
  AUTH_TIMEOUT: 15,           // SSH authentication timeout
  COMMAND_TIMEOUT: 30,        // Command execution timeout
  
  // Retry and Throttling
  RESTART_MSG_THROTTLE_MS: 15000,  // Throttle restart messages every 15s per IP
  RETRY_NOTIFICATION_DURATION: 0,  // Persistent notifications (0 = no auto-close)
  
  // Session Storage Keys
  DELAY_START_KEY_PREFIX: '_networkApplyPollingDelayStart',
  RESTART_ENDTIME_KEY_PREFIX: '_networkApplyRestartEndTimes',
  BOOT_ENDTIME_KEY_PREFIX: '_networkApplyBootEndTimes',
  HOSTNAME_MAP_KEY_PREFIX: '_hostnameMap',
  
  // Backend Endpoints
  POLL_SSH_ENDPOINT: '/poll-ssh-status',
  CHECK_SSH_ENDPOINT: '/check-ssh-status',
  NODE_STATUS_ENDPOINT: '/node-status',
  
  // Response reliability constants
  RESPONSE_RETRY_COUNT: 3,         // Number of retries for failed responses
  RESPONSE_RETRY_DELAY: 2000,      // Delay between retries (2 seconds)
  RESPONSE_TIMEOUT: 10000,         // Timeout for response waiting (10 seconds)
  
  // Error Messages
  MESSAGES: {
    CONNECTION_TIMEOUT: 'Failed to connect after multiple attempts. The node may be taking longer than expected to come up.',
    TCP_UNREACHABLE: 'TCP port 22 is not reachable on target host',
    KEY_NOT_FOUND: 'SSH key file not found on server',
    AUTH_FAILED: 'SSH authentication failed',
    CONNECTION_REFUSED: 'Connection refused by target host',
    NETWORK_UNREACHABLE: 'Network is unreachable',
    HOST_UNREACHABLE: 'Host is unreachable',
    RESPONSE_LOST: 'Response received but processing failed. Please check node status manually.'
  }
};

/**
 * Generate component-specific session storage keys
 * @param {string} component - Component name (e.g., 'cloud', 'sv')
 * @param {string} keyType - Key type suffix
 * @returns {string} Full storage key
 */
export const getStorageKey = (component, keyType) => {
  return `${component}${SSH_CONFIG[keyType]}`;
};

/**
 * Standardized SSH error message parser
 * @param {string} errorMessage - Raw error message from SSH connection
 * @returns {string} User-friendly error message
 */
export const parseSSHError = (errorMessage) => {
  const msg = errorMessage.toLowerCase();
  
  if (msg.includes('connection refused')) {
    return SSH_CONFIG.MESSAGES.CONNECTION_REFUSED;
  }
  if (msg.includes('network is unreachable')) {
    return SSH_CONFIG.MESSAGES.NETWORK_UNREACHABLE;
  }
  if (msg.includes('no route to host') || msg.includes('host unreachable')) {
    return SSH_CONFIG.MESSAGES.HOST_UNREACHABLE;
  }
  if (msg.includes('authentication failed') || msg.includes('auth')) {
    return SSH_CONFIG.MESSAGES.AUTH_FAILED;
  }
  if (msg.includes('key not found') || msg.includes('no such file')) {
    return SSH_CONFIG.MESSAGES.KEY_NOT_FOUND;
  }
  if (msg.includes('tcp 22') || msg.includes('port 22')) {
    return SSH_CONFIG.MESSAGES.TCP_UNREACHABLE;
  }
  
  // Return original message if no pattern matches
  return errorMessage;
};

/**
 * Create standardized SSH polling notification
 * @param {string} ip - Target IP address
 * @param {string} component - Component name for notification key
 * @param {Function} onRetry - Retry callback function
 * @returns {Object} Notification configuration
 */
export const createSSHTimeoutNotification = (ip, component, onRetry) => {
  return {
    key: `ssh-timeout-${component}-${ip}`,
    message: 'Connection Timeout',
    description: SSH_CONFIG.MESSAGES.CONNECTION_TIMEOUT,
    duration: SSH_CONFIG.RETRY_NOTIFICATION_DURATION,
    onRetry: onRetry,
    ip: ip
  };
};

/**
 * Validate SSH configuration before starting polling
 * @param {string} ip - Target IP address
 * @param {Object} hostIP - Host IP for backend calls
 * @returns {Object} Validation result
 */
export const validateSSHConfig = (ip, hostIP) => {
  if (!ip || typeof ip !== 'string') {
    return { valid: false, error: 'Invalid IP address provided' };
  }
  
  if (!hostIP) {
    return { valid: false, error: 'Host IP not configured' };
  }
  
  // Basic IP format validation
  const ipRegex = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/;
  if (!ipRegex.test(ip)) {
    return { valid: false, error: 'Invalid IP address format' };
  }
  
  return { valid: true };
};

/**
 * Enhanced fetch with retry mechanism to prevent response loss
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} retries - Number of retries
 * @returns {Promise} Fetch promise with retry logic
 */
export const fetchWithRetry = async (url, options = {}, retries = SSH_CONFIG.RESPONSE_RETRY_COUNT) => {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SSH_CONFIG.RESPONSE_TIMEOUT);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response;
    } catch (error) {
      console.warn(`Fetch attempt ${i + 1} failed:`, error.message);
      
      if (i === retries) {
        throw new Error(`Failed after ${retries + 1} attempts: ${error.message}`);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, SSH_CONFIG.RESPONSE_RETRY_DELAY));
    }
  }
};

/**
 * Parse and validate SSH response to ensure data integrity
 * @param {Object} data - Response data from SSH endpoint
 * @param {string} expectedIp - Expected IP address in response
 * @returns {Object} Validated response object
 */
export const validateSSHResponse = (data, expectedIp) => {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response format');
  }
  
  if (!data.status) {
    throw new Error('Missing status in response');
  }
  
  if (expectedIp && data.ip !== expectedIp) {
    throw new Error(`IP mismatch: expected ${expectedIp}, got ${data.ip}`);
  }
  
  return {
    ...data,
    validated: true,
    timestamp: Date.now()
  };
};

export default SSH_CONFIG;