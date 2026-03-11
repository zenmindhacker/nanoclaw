import https from 'https';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const tokensPath = '/workspace/extra/credentials/xero-tokens.json';
const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

const refreshToken = tokens.refresh_token;
const clientId = '748CC12001CF4C89A17B5C7FBD7D9965';
const clientSecret = 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh';

// The scopes we need - including accounting.attachments
const scopes = [
  'openid',
  'profile', 
  'email',
  'accounting.contacts',
  'accounting.settings',
  'accounting.transactions',
  'accounting.attachments',  // THIS IS WHAT WE WERE MISSING!
  'offline_access'
].join(' ');

console.log('Required scopes:', scopes);

// We need to re-authorize to get new scopes
// Since we only have refresh_token, we can only refresh existing scopes
// But the issue is that the original authorization didn't include accounting.attachments

console.log('\n⚠️  The current token was authorized WITHOUT accounting.attachments scope.');
console.log('To fix this, you need to:');
console.log('1. Go to https://login.xero.com/identity/connect/authorize');
console.log('2. Authorize again with the accounting.attachments scope');
console.log('3. Update the credentials file with the new tokens');
console.log('\nOr we can try using the refresh token with a new authorization...');

console.log('\nCurrent scopes in token:', tokens.scope);
