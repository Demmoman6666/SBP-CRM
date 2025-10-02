// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---------------- Settings & Permissions ----------------
enum Role {
  ADMIN
  MANAGER
  REP
  VIEWER
}

enum Permission {
  VIEW_SALES_HUB
  VIEW_REPORTS
  VIEW_CUSTOMERS
  EDIT_CUSTOMERS
  VIEW_CALLS
  EDIT_CALLS
  VIEW_PROFIT_CALC
  VIEW_SETTINGS
}

// Targets enums
enum TargetScope {
  COMPANY
  REP
  VENDOR
}

enum TargetMetric {
  REVENUE
  ORDERS
  NEW_CUSTOMERS
}

// Customer lifecycle/stage
enum CustomerStage {
  LEAD
  APPOINTMENT_BOOKED
  SAMPLING
  CUSTOMER
}

// NEW: Education request status
enum EducationRequestStatus {
  REQUESTED
  BOOKED
  CANCELLED
}

// NEW: Education type multi-select
enum EducationType {
  PERMANENT_COLOUR
  SEMI_PERMANENT_COLOUR
  CARE_RANGE
  STYLING_RANGE
}

// ---------------- Route Planning ----------------
enum RouteDay {
  MONDAY
  TUESDAY
  WEDNESDAY
  THURSDAY
  FRIDAY
}

// ---------------- Purchase Ordering / Linnworks ----------------
enum PlanStatus {
  DRAFT
  ORDERED
  CANCELLED
  ARCHIVED
}

model User {
  id           String           @id @default(cuid())
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  fullName     String
  email        String           @unique
  phone        String?
  passwordHash String

  role         Role             @default(REP)
  isActive     Boolean          @default(true)

  // Google OAuth / Calendar
  googleEmail          String?  @unique
  googleAccessToken    String?
  googleRefreshToken   String?
  googleTokenExpiresAt DateTime?
  googleCalendarId     String?  @default("primary")

  // fine-grained overrides in addition to role
  overrides    UserPermission[]
  // back-relation for AuditLog.user
  auditLogs    AuditLog[]

  // purchase plans created by this user
  purchasePlans PurchasePlan[]

  @@index([role])
}

model UserPermission {
  id        String     @id @default(cuid())
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  perm      Permission
  createdAt DateTime   @default(now())

  @@unique([userId, perm])
  @@index([perm])
}

model AuditLog {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  action    String
  details   Json?
}

// ---------------- Existing CRM models ----------------
model Customer {
  id                   String    @id @default(cuid())
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  salonName            String
  customerName         String
  addressLine1         String
  addressLine2         String?
  town                 String?
  county               String?
  postCode             String?
  country              String?
  daysOpen             String?
  brandsInterestedIn   String?
  notes                String?

  // LEGACY free-text rep (kept for backward compatibility)
  salesRep             String?
  // ✅ Canonical link to SalesRep
  salesRepId           String?
  rep                  SalesRep? @relation("CustomerRep", fields: [salesRepId], references: [id], onDelete: SetNull)

  customerNumber       String?
  customerTelephone    String?
  customerEmailAddress String?
  openingHours         String?
  numberOfChairs       Int?

  // lifecycle stage
  stage                CustomerStage @default(LEAD)

  visits               Visit[]
  notesLog             Note[]
  callLogs             CallLog[]

  // NEW: education relations
  educationRequests    EducationRequest[]
  educationBookings    EducationBooking[]

  // Shopify sync fields
  shopifyCustomerId    String?   @unique
  shopifyTags          String[]  @default([])
  shopifyLastSyncedAt  DateTime?

  // --- NEW: Payment terms (applied to Shopify draft orders) ---
  paymentDueLater       Boolean  @default(false)
  paymentTermsName      String?
  paymentTermsDueInDays Int?

  // Orders relationship
  orders               Order[]

  // ---------------- Route Planning ----------------
  routePlanEnabled     Boolean     @default(false)
  routeWeeks           Int[]       @default([])
  routeDays            RouteDay[]  @default([])

  @@index([customerEmailAddress])
  @@index([salesRep])          // legacy text index
  @@index([salesRepId])        // ✅ canonical rep index
  @@index([stage])
  @@index([routePlanEnabled, salesRep])
}

model Visit {
  id               String    @id @default(cuid())
  customerId       String
  customer         Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  date             DateTime  @default(now())
  startTime        DateTime?
  endTime          DateTime?
  durationMinutes  Int?

  summary          String?
  staff            String?

  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([customerId, date])
}

model Note {
  id          String    @id @default(cuid())
  customerId  String
  customer    Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  text        String
  staff       String?
  createdAt   DateTime  @default(now())

  @@index([customerId, createdAt])
}

model SalesRep {
  id        String   @id @default(cuid())
  name      String   @unique
  email     String?
  createdAt DateTime @default(now())

  tagRules  SalesRepTagRule[]

  // back-relations
  targets   Target[]   @relation("TargetRep")
  customers Customer[] @relation("CustomerRep")
  callLogs  CallLog[]  @relation("CallLogRep")
}

model Brand {
  id               String   @id @default(cuid())
  name             String   @unique
  createdAt        DateTime @default(now())

  visibleInCallLog Boolean  @default(false)

  competitorLinks  CallLogCompetitorBrand[]
}

model CallLog {
  id                   String   @id @default(cuid())
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  isExistingCustomer   Boolean

  customerId           String?
  customer             Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)

  customerName         String?
  contactPhone         String?
  contactEmail         String?

  callType             String?
  summary              String?
  outcome              String?

  // LEGACY free-text rep (kept for backward compatibility)
  staff                String?

  // ✅ Canonical link to SalesRep
  repId                String?
  rep                  SalesRep? @relation("CallLogRep", fields: [repId], references: [id], onDelete: SetNull)

  stage                CustomerStage?

  followUpRequired     Boolean   @default(false)
  followUpAt           DateTime?

  startTime            DateTime?
  endTime              DateTime?
  durationMinutes      Int?
  appointmentBooked    Boolean?  @default(false)

  latitude             Float?
  longitude            Float?
  accuracyM            Float?
  geoCollectedAt       DateTime?

  stockedBrandLinks    CallLogStockedBrand[]
  competitorBrandLinks CallLogCompetitorBrand[]

  @@index([createdAt])
  @@index([isExistingCustomer, customerId])
  @@index([stage])
  // ✅ helpful filters
  @@index([repId])
  @@index([staff])
  @@index([callType])
  @@index([outcome])
}

model StockedBrand {
  id               String   @id @default(cuid())
  name             String   @unique
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  visibleInCallLog Boolean  @default(false)

  callLinks        CallLogStockedBrand[]

  targets          Target[]  @relation("TargetVendor")
}

model Order {
  id                 String     @id @default(cuid())
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt

  // Shopify identifiers
  shopifyOrderId     String?    @unique
  shopifyOrderNumber Int?
  shopifyName        String?
  shopifyCustomerId  String?

  // Customer link
  customerId         String?
  customer           Customer?  @relation(fields: [customerId], references: [id], onDelete: SetNull)

  // Timestamps & status
  processedAt        DateTime?
  currency           String?
  financialStatus    String?
  fulfillmentStatus  String?

  // Money
  subtotal           Decimal?   @db.Decimal(12, 2)
  total              Decimal?   @db.Decimal(12, 2)
  taxes              Decimal?   @db.Decimal(12, 2)
  discounts          Decimal?   @db.Decimal(12, 2)
  shipping           Decimal?   @db.Decimal(12, 2)

  lineItems          OrderLineItem[]

  @@index([customerId, processedAt])
  @@index([shopifyCustomerId])
}

model OrderLineItem {
  id                String   @id @default(cuid())
  orderId           String
  order             Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)

  shopifyLineItemId String?  @unique
  productId         String?
  productTitle      String?
  variantId         String?
  variantTitle      String?
  sku               String?

  productVendor     String?

  quantity          Int      @default(1)
  price             Decimal? @db.Decimal(12, 2)
  total             Decimal? @db.Decimal(12, 2)

  createdAt         DateTime @default(now())

  @@index([orderId])
  @@index([productVendor])
}

model SalesRepTagRule {
  id          String   @id @default(cuid())
  tag         String   @unique
  salesRepId  String
  salesRep    SalesRep @relation(fields: [salesRepId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
}

model ShopifySyncState {
  id                    Int      @id @default(1)
  lastCustomersSyncedAt DateTime?
  lastOrdersSyncedAt    DateTime?
  lastWebhookReceivedAt DateTime?
  updatedAt             DateTime @updatedAt
}

model WebhookLog {
  id        String   @id @default(cuid())
  topic     String
  shopifyId String?
  payload   Json
  createdAt DateTime @default(now())

  @@index([topic, createdAt])
}

// Targets model
model Target {
  id           String        @id @default(cuid())
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  scope        TargetScope
  metric       TargetMetric

  periodStart  DateTime
  periodEnd    DateTime

  amount       Decimal       @db.Decimal(12, 2)
  currency     String?       @default("GBP")

  // Optional dimensions per scope
  repId        String?
  rep          SalesRep?     @relation("TargetRep", fields: [repId], references: [id], onDelete: SetNull)

  vendorId     String?
  vendor       StockedBrand? @relation("TargetVendor", fields: [vendorId], references: [id], onDelete: SetNull)

  notes        String?

  @@index([scope, metric, periodStart, periodEnd])
  @@index([repId])
  @@index([vendorId])
  @@unique([scope, metric, periodStart, periodEnd, repId, vendorId], map: "scope_metric_periodStart_periodEnd_repId_vendorId")
}

// ---------------- Many-to-many join tables for CallLog x Brands ----------------
model CallLogStockedBrand {
  id        String       @id @default(cuid())
  callLogId String
  brandId   String
  createdAt DateTime     @default(now())

  callLog   CallLog      @relation(fields: [callLogId], references: [id], onDelete: Cascade)
  brand     StockedBrand @relation(fields: [brandId], references: [id], onDelete: Cascade)

  @@unique([callLogId, brandId])
  @@index([brandId])
}

model CallLogCompetitorBrand {
  id        String   @id @default(cuid())
  callLogId String
  brandId   String
  createdAt DateTime @default(now())

  callLog   CallLog  @relation(fields: [callLogId], references: [id], onDelete: Cascade)
  brand     Brand    @relation(fields: [brandId], references: [id], onDelete: Cascade)

  @@unique([callLogId, brandId])
  @@index([brandId])
}

// ---------------- Education Requests & Bookings ----------------
model EducationRequest {
  id           String                 @id @default(cuid())
  createdAt    DateTime               @default(now())
  updatedAt    DateTime               @updatedAt

  customerId   String
  customer     Customer               @relation(fields: [customerId], references: [id], onDelete: Cascade)

  status       EducationRequestStatus @default(REQUESTED)

  // Snapshot of contact/location details at the time of request
  salonName    String?
  contactName  String?
  phone        String?
  email        String?
  addressLine1 String?
  addressLine2 String?
  town         String?
  county       String?
  postCode     String?
  country      String?

  // Captured from the form
  brands          String[]        @default([])
  educationTypes  EducationType[] @default([])

  notes        String?

  // 1:1 link to a created booking
  booking      EducationBooking?  @relation("RequestBooking")

  @@index([customerId, createdAt])
  @@index([status])
}

model EducationBooking {
  id             String            @id @default(cuid())
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  // 1:1 back to the request — FK must be unique
  requestId      String?           @unique
  request        EducationRequest? @relation("RequestBooking", fields: [requestId], references: [id], onDelete: SetNull)

  customerId     String
  customer       Customer          @relation(fields: [customerId], references: [id], onDelete: Cascade)

  title          String?
  startAt        DateTime?
  endAt          DateTime?
  location       String?

  brand          String?
  educationTypes EducationType[]   @default([])

  notes          String?

  @@index([customerId, startAt])
}

// ---------------- Purchase Ordering & Linnworks Integration ----------------

// Linnworks stock item GUID mapping (SKU <-> pkStockItemId)
model LwStockItemMap {
  id            String   @id @default(cuid())
  sku           String   @unique
  stockItemId   String   @unique // Linnworks pkStockItemId (GUID)
  title         String?
  barcode       String?
  supplierId    String?
  supplier      LwSupplier? @relation(fields: [supplierId], references: [id], onDelete: SetNull)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([stockItemId])
  @@index([supplierId])
}

// Linnworks suppliers cache + defaults (optional overrides)
model LwSupplier {
  id                  String   @id              // Linnworks SupplierId (GUID)
  name                String   @unique
  defaultLeadTimeDays Int?
  defaultPackSize     Int?
  defaultMoq          Int?
  defaultCurrency     String?  @default("GBP")
  defaultPurchasePrice Decimal? @db.Decimal(12, 4)

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  // back-relations
  skuOverrides  SkuOverride[]
  stockItemMaps LwStockItemMap[]
  purchasePlans PurchasePlan[]
  planLines     PurchasePlanLine[]
  poSyncs       PurchaseOrderSync[]
}

// Linnworks stock locations cache
model LwLocation {
  id        String   @id        // Linnworks LocationId (GUID)
  name      String   @unique
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // back-relations
  purchasePlans PurchasePlan[]
  poSyncs       PurchaseOrderSync[]
}

// Presets for forecasting behaviour
model ForecastPreset {
  id          String   @id @default(cuid())
  name        String   @unique
  reviewDays  Int      @default(7)
  bufferDays  Int      @default(2)
  serviceZ    Float    @default(1.64) // ~95% service level
  horizonDays Int      @default(14)
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Per-SKU overrides to augment Linnworks supplier stats
model SkuOverride {
  id             String      @id @default(cuid())
  sku            String      @unique
  supplierId     String?
  supplier       LwSupplier? @relation(fields: [supplierId], references: [id], onDelete: SetNull)
  leadTimeDays   Int?
  packSize       Int?
  moq            Int?
  blockAuto      Boolean     @default(false)
  notes          String?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
}

// A planning run/snapshot for a given location and horizon
model PurchasePlan {
  id            String     @id @default(cuid())
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  title         String?
  notes         String?

  createdById   String?
  createdBy     User?      @relation(fields: [createdById], references: [id], onDelete: SetNull)

  status        PlanStatus @default(DRAFT)

  // location to plan against (stock levels are location-scoped in Linnworks)
  locationId    String
  location      LwLocation @relation(fields: [locationId], references: [id], onDelete: Restrict)

  // planning parameters
  horizonDays   Int
  lookbackDays  Int
  reviewDays    Int        @default(7)
  bufferDays    Int        @default(0)
  serviceZ      Float      @default(1.64)
  currency      String?    @default("GBP")

  // optional supplier focus (null means all suppliers)
  supplierId    String?
  supplier      LwSupplier? @relation(fields: [supplierId], references: [id], onDelete: SetNull)

  // relations
  lines         PurchasePlanLine[]
  poSyncs       PurchaseOrderSync[]   // <— back-relation added

  @@index([status, createdAt])
  @@index([locationId])
  @@index([supplierId])
}

// Lines produced by a planning run (pre-PO and post-PO snapshot)
model PurchasePlanLine {
  id            String     @id @default(cuid())
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  planId        String
  plan          PurchasePlan @relation(fields: [planId], references: [id], onDelete: Cascade)

  // identification
  sku           String
  stockItemId   String                 // Linnworks pkStockItemId (GUID)
  supplierId    String?
  supplier      LwSupplier? @relation(fields: [supplierId], references: [id], onDelete: SetNull)

  // demand inputs
  avgDaily      Float
  dailyStdDev   Float?
  leadTimeDays  Int?
  packSize      Int?
  moq           Int?

  // stock context (location-scoped)
  onHand        Int?
  inOrderBook   Int?
  due           Int?

  // computed metrics
  safety        Float?
  rop           Float?
  target        Float?
  netPos        Float?

  // suggestions
  suggestedQty  Int
  adjustedQty   Int?

  // costing
  unitCost      Decimal? @db.Decimal(12, 4)
  extendedCost  Decimal? @db.Decimal(12, 2)

  // linkage to actual PO (if created)
  poId          String?   // Linnworks pkPurchaseId (GUID)
  poNumber      String?
  poStatus      String?

  // raw payloads for audit/debug
  source        Json?
  calc          Json?

  @@index([planId])
  @@index([supplierId])
  @@index([stockItemId])
  @@index([poId])
  @@unique([planId, sku], map: "plan_sku_unique")
}

// Record of POs created in Linnworks from the planner (one row per LW PO)
model PurchaseOrderSync {
  id               String     @id @default(cuid())
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  planId           String?
  plan             PurchasePlan? @relation(fields: [planId], references: [id], onDelete: SetNull)

  supplierId       String?
  supplier         LwSupplier? @relation(fields: [supplierId], references: [id], onDelete: SetNull)

  locationId       String
  location         LwLocation  @relation(fields: [locationId], references: [id], onDelete: Restrict)

  lwPurchaseId     String     @unique // pkPurchaseId from Linnworks
  purchaseOrderNumber String?
  status           String?
  currency         String?    @default("GBP")
  deliveryDate     DateTime?
  linesCount       Int?
  totalCost        Decimal?   @db.Decimal(12, 2)

  // store full LW responses for traceability
  requestPayload   Json?
  responsePayload  Json?

  @@index([supplierId, createdAt])
  @@index([locationId, createdAt])
}

// ---------------- Inventory snapshots (Shopify) ----------------
// Daily snapshot of available inventory per SKU (optionally per location).
// Enables exact "Days Out of Stock" by counting days with available === 0.

model InventoryDay {
  id           String   @id @default(cuid())
  date         DateTime
  sku          String
  locationId   String
  locationName String?
  available    Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([sku, date, locationId], map: "invday_sku_date_location")
  @@index([date])
  @@index([sku])
  @@index([locationId])
}

// ---------------- Shopify Variant Cost Cache ----------------
// Minimal cache so routes can read/write prisma.shopifyVariantCost
model ShopifyVariantCost {
  id        String   @id @default(cuid())
  variantId String   @unique        // numeric Shopify ProductVariant ID
  unitCost  Decimal? @db.Decimal(12, 4)
  currency  String?  @default("GBP")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([variantId])
}
