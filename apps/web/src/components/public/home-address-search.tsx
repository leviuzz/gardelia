'use client';

import { useRouter } from 'next/navigation';
import { AddressSearch, type FoundAddress } from '@/components/form/address-search';
import { buyerRoutes } from '@/lib/routes';

/**
 * "Buscar dirección" della home (ADR-066): scelto un suggerimento, si cercano le fiorerie che
 * consegnano lì. Le coordinate vanno solo nell'indirizzo della ricerca, non si salvano.
 */
export function HomeAddressSearch() {
  const router = useRouter();
  function search(found: FoundAddress) {
    router.push(
      buyerRoutes.search({
        lat: found.coordinates?.latitude,
        lng: found.coordinates?.longitude,
        ciudad: found.city ?? undefined,
        dir: [found.addressLine1, found.neighborhood].filter(Boolean).join(', '),
      }),
    );
  }
  return <AddressSearch id="home-address" onFound={search} />;
}
