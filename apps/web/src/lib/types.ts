// Domain types, all derived from the generated contract types (never hand-written).
import type { components as Catalog } from '@/api/generated/catalog';
import type { components as Gateway } from '@/api/generated/gateway';
import type { components as Inventory } from '@/api/generated/inventory';
import type { components as Orders } from '@/api/generated/orders';
import type { components as Queue } from '@/api/generated/queue';

export type EventDetail = Catalog['schemas']['Event'];
export type EventPage = Catalog['schemas']['EventPage'];
export type SaleState = Catalog['schemas']['SaleState'];
export type SalesRules = Catalog['schemas']['SalesRules'];
export type Sector = Catalog['schemas']['Sector'];
export type Availability = Inventory['schemas']['Availability'];
export type QueueStatus = Queue['schemas']['QueueStatus'];
export type Order = Orders['schemas']['Order'];
export type OrderCreated = Orders['schemas']['OrderCreated'];
export type OrderPage = Orders['schemas']['OrderPage'];
export type OrderStatus = Orders['schemas']['OrderStatus'];
export type PaymentIntent = Orders['schemas']['PaymentIntent'];
export type LoginResponse = Gateway['schemas']['LoginResponse'];
export type Problem = Orders['schemas']['Problem'];
export type ErrorCode = Orders['schemas']['ErrorCode'];
