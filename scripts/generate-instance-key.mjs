#!/usr/bin/env node
/**
 * Generates the Ed25519 instance identity for federation (signed teaching
 * record exports). Prints the value for INSTANCE_SIGNING_KEY — store it as a
 * secret; the public key is derived from it and served at
 * /.well-known/bytes-teaching.
 */
import { generateKeyPairSync } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')

const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

console.log('Add to your environment (server-only secret):\n')
console.log(`INSTANCE_SIGNING_KEY=${priv}\n`)
console.log(`Derived public key (served automatically at /.well-known/bytes-teaching):\n${pub}`)
