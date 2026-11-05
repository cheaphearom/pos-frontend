export type Role = 'SUPER_ADMIN' | 'STORE_MANAGER' | 'CASHIER';

export interface StoreRef { id: string; code: string; name: string }

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  stores: StoreRef[];
}

export interface Store extends StoreRef {
  address?: string | null;
  phone?: string | null;
  currency: string;
  taxRate: string;
  isActive: boolean;
  hasKitchen?: boolean;
  khqrAccountId?: string | null;
}

export interface Category { id: string; name: string; parentId: string | null; _count?: { products: number } }

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description?: string | null;
  categoryId: string | null;
  category?: { id: string; name: string } | null;
  unit: string;
  costPrice: string;
  sellPrice: string;
  taxable: boolean;
  trackStock: boolean;
  isActive: boolean;
  price?: string;
  stock?: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super admin',
  STORE_MANAGER: 'Store manager',
  CASHIER: 'Cashier',
};

export const PAYMENT_METHODS = ['CASH', 'CARD', 'KHQR', 'BANK_TRANSFER', 'WALLET', 'E_WALLET', 'OTHER'] as const;
