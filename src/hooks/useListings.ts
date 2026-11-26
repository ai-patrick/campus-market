import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
} from 'firebase/firestore';
import { db } from '@lib/firebase/config';
import { listingsCol, feedQuery, myListingsQuery, bundleItemsQuery } from '@lib/firebase/firestore';
import { Product, excludeOwners, sortProducts } from '@models/Product';
import { FeedFilter, filterProducts } from '@models/FeedFilter';

const LISTINGS_QUERY_KEY = 'listings';

export function useFeedListings() {
  return useQuery({
    queryKey: [LISTINGS_QUERY_KEY, 'feed'],
    queryFn: async () => {
      const q = feedQuery();
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
    },
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Real-time feed listener that properly updates React Query cache.
 * Uses useEffect to maintain a persistent listener that updates cache on every snapshot.
 */
export function useRealtimeFeed() {
  const queryClient = useQueryClient();
  const queryKey = [LISTINGS_QUERY_KEY, 'realtime'];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const q = feedQuery();
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
    },
    staleTime: 0,
    initialData: queryClient.getQueryData(queryKey) as Product[] | undefined,
  });

  // Set up real-time listener
  useEffect(() => {
    const q = feedQuery();
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
        queryClient.setQueryData(queryKey, products);
      },
      (error) => {
        console.error('Real-time feed listener error:', error);
        // Error will be picked up on next refetch; don't use setQueryError (doesn't exist)
      }
    );

    return () => unsubscribe();
  }, [queryClient, queryKey]);

  return query;
}

export function useMyListings(userId: string | undefined) {
  return useQuery({
    queryKey: [LISTINGS_QUERY_KEY, 'mine', userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return [];
      const q = myListingsQuery(userId);
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
    },
    staleTime: 1000 * 60,
  });
}

export function useRealtimeMyListings(userId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = [LISTINGS_QUERY_KEY, 'mine-realtime', userId];

  const query = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return [];
      const q = myListingsQuery(userId);
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
    },
    staleTime: 0,
    initialData: queryClient.getQueryData(queryKey) as Product[] | undefined,
  });

  useEffect(() => {
    if (!userId) return;

    const q = myListingsQuery(userId);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
        queryClient.setQueryData(queryKey, products);
      },
      (error) => {
        console.error('Real-time my listings listener error:', error);
      }
    );

    return () => unsubscribe();
  }, [queryClient, queryKey, userId]);

  return query;
}

export function useBundleItems(bundleId: string | undefined) {
  return useQuery({
    queryKey: [LISTINGS_QUERY_KEY, 'bundle-items', bundleId],
    enabled: !!bundleId,
    queryFn: async () => {
      if (!bundleId) return [];
      const q = bundleItemsQuery(bundleId);
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
    },
    staleTime: 1000 * 60,
  });
}

export function useRealtimeBundleItems(bundleId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = [LISTINGS_QUERY_KEY, 'bundle-items-realtime', bundleId];

  const query = useQuery({
    queryKey,
    enabled: !!bundleId,
    queryFn: async () => {
      if (!bundleId) return [];
      const q = bundleItemsQuery(bundleId);
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
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
        const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Product[];
        queryClient.setQueryData(queryKey, products);
      },
      (error) => {
        console.error('Real-time bundle items listener error:', error);
      }
    );

    return () => unsubscribe();
  }, [queryClient, queryKey, bundleId]);

  return query;
}

export function useCreateListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (product: Omit<Product, 'id'>) => {
      const docRef = await addDoc(listingsCol, product);
      return { id: docRef.id, ...product };
    },
    onMutate: async (newProduct) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: [LISTINGS_QUERY_KEY] });

      // Snapshot previous data for potential rollback
      const previousFeed = queryClient.getQueryData<Product[]>([LISTINGS_QUERY_KEY, 'realtime']);
      const previousFeedStatic = queryClient.getQueryData<Product[]>([LISTINGS_QUERY_KEY, 'feed']);

      // Optimistically add the new product to both real-time and static feed caches
      const optimisticProduct = { ...newProduct, id: `temp-${Date.now()}` } as Product;

      queryClient.setQueryData<Product[]>([LISTINGS_QUERY_KEY, 'realtime'], (old) =>
        old ? [optimisticProduct, ...old] : [optimisticProduct]
      );
      queryClient.setQueryData<Product[]>([LISTINGS_QUERY_KEY, 'feed'], (old) =>
        old ? [optimisticProduct, ...old] : [optimisticProduct]
      );

      // Also update my-listings if we have that cache
      queryClient.setQueryData<Product[]>([LISTINGS_QUERY_KEY, 'mine-realtime', newProduct.ownerId], (old) =>
        old ? [optimisticProduct, ...old] : [optimisticProduct]
      );

      return { previousFeed, previousFeedStatic };
    },
    onSuccess: (newProduct) => {
      // Replace temp ID with real ID in all caches
      const updateCache = (key: string[]) => {
        queryClient.setQueryData<Product[]>(key, (old) =>
          old?.map((p) => (p.id.startsWith('temp-') ? newProduct : p)) ?? []
        );
      };

      updateCache([LISTINGS_QUERY_KEY, 'realtime']);
      updateCache([LISTINGS_QUERY_KEY, 'feed']);
      updateCache([LISTINGS_QUERY_KEY, 'mine-realtime', newProduct.ownerId]);

      // Invalidate to trigger background refetch for consistency
      queryClient.invalidateQueries({ queryKey: [LISTINGS_QUERY_KEY] });
    },
    onError: (err, _newProduct, context) => {
      // Rollback to previous data
      if (context?.previousFeed !== undefined) {
        queryClient.setQueryData([LISTINGS_QUERY_KEY, 'realtime'], context.previousFeed);
      }
      if (context?.previousFeedStatic !== undefined) {
        queryClient.setQueryData([LISTINGS_QUERY_KEY, 'feed'], context.previousFeedStatic);
      }
      console.error('Create listing failed:', err);
    },
  });
}

export function useMarkSold() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listingId: string) => {
      await updateDoc(doc(db, 'listings', listingId), { status: 'SOLD' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LISTINGS_QUERY_KEY] });
    },
  });
}

export function useReopenListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listingId: string) => {
      await updateDoc(doc(db, 'listings', listingId), { status: 'ACTIVE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LISTINGS_QUERY_KEY] });
    },
  });
}

export function useRenewListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listingId: string) => {
      const newExpiry = Date.now() + 14 * 24 * 60 * 60 * 1000;
      await updateDoc(doc(db, 'listings', listingId), {
        status: 'ACTIVE',
        expiresAt: newExpiry,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LISTINGS_QUERY_KEY] });
    },
  });
}

export function useDeleteListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listingId: string) => {
      await deleteDoc(doc(db, 'listings', listingId));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LISTINGS_QUERY_KEY] });
    },
  });
}

export function useProcessedFeed(
  allProducts: Product[] | undefined,
  filter: FeedFilter,
  searchQuery: string,
  blockedOwnerIds: Set<string>
) {
  if (!allProducts) return [];

  let filtered = allProducts;

  // Apply search
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (p) =>
        p.title.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query) ||
        p.location.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
    );
  }

  // Apply feed filter
  filtered = filterProducts(filtered, filter);

  // Exclude blocked owners
  filtered = excludeOwners(filtered, blockedOwnerIds);

  // Apply sort
  filtered = sortProducts(filtered, filter.sort);

  return filtered;
}