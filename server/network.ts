import { networkInterfaces } from 'node:os'

/** Non-internal IPv4 addresses, so phones on the LAN can reach the server. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address)
}
