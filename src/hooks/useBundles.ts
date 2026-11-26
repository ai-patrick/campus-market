import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { query, onSnapshot, getDocs, writeBatch, doc, collection, where } from 'firebase/firestore';
import { db } from '@lib/firebase/config';
import { activeBundlesQuery, bundleItemsQuery } from '@lib/firebase/firestore';
import { MoveOutBundle, isBundleActive, bundleToFirestore } from '@models/MoveOutBundle';
import { Product } from '@models/Product';

const BUNDLES_QUERY_KEY = 'bundles';

export function useBundles() {
  return useQuery({
    queryKey: [BUNDLES_QUERY_KEY, 'active'],
    queryFn: async () => {
      const q = activeBundlesQuery();
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() })) as MoveOutBundle[];
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useRealtimeBundles() {
  const queryClient = useQueryClient();
  const queryKey = [BUNDLES_QUERY_KEY, 'active-realtime'];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const q = activeBundlesQuery();
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() })) as MoveOutBundle[];
    },
    staleTime: 0,
    initialData: queryClient.getQueryData(queryKey) as MoveOutBundle[] | undefined,
  });

  useEffect(() => {
    const q = activeBundlesQuery();
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const bundles = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() })) as MoveOutBundle[];
        const activeBundles = bundles.filter(isBundleActive);
        queryClient.setQueryData(queryKey, activeBundles);
      },
      (error) => {
        console.error('Real-time bundles listener error:', error);
      }
    );

    return () => unsubscribe();
  }, [queryClient, queryKey]);

  return query;
}

export function useCreateBundle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      bundle,
      listingIds,
    }: {
      bundle: Omit<MoveOutBundle, 'id'>;
      listingIds: string[];
    }) => {
      const batch = writeBatch(db);

      // Create bundle document
      const bundleRef = doc(db, 'bundles');
      batch.set(bundleRef, bundleToFirestore({ ...bundle, id: bundleRef.id } as MoveOutBundle));

      // Update each listing with bundleId
      for (const listingId of listingIds) {
        const listingRef = doc(db, 'listings', listingId);
        batch.update(listingRef, { bundleId: bundleRef.id });
      }

      await batch.commit();
      return { id: bundleRef.id, ...bundle };
    },
    onMutate: async ({ bundle, listingIds }) => {
      await queryClient.cancelQueries({ queryKey: [BUNDLES_QUERY_KEY] });

      const previousBundles = queryClient.getQueryData<MoveOutBundle[]>([BUNDLES_QUERY_KEY, 'active-realtime']);
      const previousBundlesStatic = queryClient.getQueryData<MoveOutBundle[]>([BUNDLES_QUERY_KEY, 'active']);

      const optimisticBundle = { ...bundle, id: `temp-${Date.now()}`, status: 'OPEN' as const, itemIds: listingIds, createdAt: Date.now() } as MoveOutBundle;

      queryClient.setQueryData<MoveOutBundle[]>([BUNDLES_QUERY_KEY, 'active-realtime'], (old) =>
        old ? [optimisticBundle, ...old] : [optimisticBundle]
      );
      queryClient.setQueryData<MoveOutBundle[]>([BUNDLES_QUERY_KEY, 'active'], (old) =>
        old ? [optimisticBundle, ...old] : [optimisticBundle]
      );

      return { previousBundles, previousBundlesStatic };
    },
    onSuccess: (newBundle) => {
      const updateCache = (key: string[]) => {
        queryClient.setQueryData<MoveOutBundle[]>(key, (old) =>
          old?.map((b) => (b.id.startsWith('temp-') ? newBundle : b)) ?? []
        );
      };

      updateCache([BUNDLES_QUERY_KEY, 'active-realtime']);
      updateCache([BUNDLES_QUERY_KEY, 'active']);

      queryClient.invalidateQueries({ queryKey: [BUNDLES_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (_err, _newBundle, context) => {
      if (context?.previousBundles !== undefined) {
        queryClient.setQueryData([BUNDLES_QUERY_KEY, 'active-realtime'], context.previousBundles);
      }
      if (context?.previousBundlesStatic !== undefined) {
        queryClient.setQueryData([BUNDLES_QUERY_KEY, 'active'], context.previousBundlesStatic);
      }
    },
  });
}

export function useCloseBundle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (bundleId: string) => {
      const batch = writeBatch(db);

      // Find and unlink listings
      const listingsQuery = query(
        collection(db, 'listings'),
        where('bundleId', '==', bundleId)
      );
      const listingsSnapshot = await getDocs(listingsQuery);

      for (const listingDoc of listingsSnapshot.docs) {
        batch.update(listingDoc.ref, { bundleId: null });
      }

      // Delete bundle
      batch.delete(doc(db, 'bundles', bundleId));

      await batch.commit();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BUNDLES_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
  });
}

export function useAvailableBundleItems(userId: string | undefined) {
  return useQuery({
    queryKey: ['listings', 'available-for-bundle', userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return [];
      const q = query(
        collection(db, 'listings'),
        where('ownerId', '==', userId),
        where('bundleId', '==', null),
        where('status', '==', 'ACTIVE'),
        where('type', '==', 'SALE')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
    },
    staleTime: 1000 * 60,
  });
}

export function useRealtimeBundleItems(bundleId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['listings', 'bundle-items', bundleId];

  const query = useQuery({
    queryKey,
    enabled: !!bundleId,
    queryFn: async () => {
      if (!bundleId) return [];
      const q = bundleItemsQuery(bundleId);
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
    },
    staleTime: 0,
    initialData: queryClient.getQueryData(queryKey) as Product[] | undefined,
  });

  useEffect(() => {
    if (!bundleId) return;

    const q = bundleItemsQuery(bundleId);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
        queryClient.setQueryData(queryKey, items);
      },
      (error) => {
        console.error('Real-time bundle items listener error:', error);
      }
    );

    return () => unsubscribe();
  }, [queryClient, queryKey, bundleId]);

  return query;
}