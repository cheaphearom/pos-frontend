# Features

How each part of the POS works. Pages are in this project; the rules and data are in pos-backend.

## POS checkout screen

Open **http://localhost:5173/pos** (cashiers go there automatically after login; managers use the
"Open POS" button). Made for a touch screen or a PC with a USB barcode scanner.

- **Scan or search:** the scanner types the barcode and presses Enter. Type `3*8850000001` to add 3 at once.
  Tap a product tile, or filter by category.
- **Cart:** + / − buttons, tap the quantity for weights (e.g. 1.25 kg), line discount, whole-sale discount (amount or %).
- **Members:** F4, then phone or card number. Register new members on the spot. Use points as payment.
- **Payment:** cash with quick banknote buttons and change, KHQR, card, bank transfer, e-wallet, or split across several.
- **Receipt:** printed at 80 mm width for thermal printers (choose the printer in the print dialog,
  or set it as the default printer and enable silent printing in the browser kiosk mode).
- **Hold / recall** a sale while serving the next customer. The cart survives a page reload.
- **Shifts:** the POS asks the cashier to open a shift with the opening cash before the first sale.
- Keys: **F9** pay, **F2** search, **F4** member, **Enter** on an empty search opens payment, **Enter** after a sale starts the next one.

### Customer display (second screen)

A screen facing the customer that follows the POS live:

- **Welcome screen** (store name in English and Khmer, clock, today's running promotions rotating)
- **Cart**: every item as it is scanned, promotions, discount, tax, member points, total and "You save …"
- **Payment**: the **KHQR code shown large** for the customer to scan, amount and countdown; split payments show what is still to pay
- **Thank you**: change to give back, points earned, receipt number; back to the welcome screen after 20 seconds

Setup (second monitor on the same PC):

1. Plug in the second monitor and set Windows to **Extend** the display.
2. In the POS press **Customer display** (top bar). On Chrome/Edge, allow "window management" when asked and
   the window opens on the other monitor; otherwise drag it there.
3. Click **Full screen** on the display. The POS top bar shows **Display on** while it is connected.

The two windows talk directly inside the browser (`BroadcastChannel`), so it needs no server and keeps working offline.
For a shop PC that starts straight into the display, you can use a shortcut such as:
`chrome --app=https://your-pos/display?store=<storeId> --window-position=1920,0 --start-fullscreen`
(the POS must be open in the same browser profile).

### Offline mode

If the internet drops, the POS keeps selling:

1. The store's whole product list is saved on the device (IndexedDB) and refreshed every 5 minutes
   (only the changes are downloaded).
2. Totals are calculated on the device with exactly the same rules as the server
   (checked against the server code on 20,000 random carts).
3. Offline sales get a temporary receipt number (`OFF-...`) and wait in a queue on the device.
   The top bar shows **"N to upload"**.
4. When the connection returns, they upload automatically. Each sale has a unique `clientRef`,
   so a sale is never recorded twice, even if the upload is retried.
5. The server accepts offline sales even when stock is short (the goods already left the store)
   and dates them at the time they really happened (up to 7 days back).

While offline you cannot look up members or use points; earning points still works when an already
selected member's sale uploads. If the server rejects an offline sale (for example a product was deleted),
it stays in the queue with the reason so a manager can retry or delete it.

The app itself also opens without internet (service worker), after it has been opened once online.
Service workers need **HTTPS** (or `localhost`), so serve the production build over HTTPS for tills.

## Café mode (coffee shops)

Turn on **Café mode** for a store (Stores page). Then:

- **Drink options** (Catalogue → Drink options): groups like *Size* (Small / Medium +0.50 / Large +1.00),
  *Sugar* (0–100%), *Ice*, *Milk* (Oat +0.60), *Extras* (up to 3). Each group is required or optional, choose-one or
  choose-several, with a default. Attach groups to drinks on the Products page (also a photo URL for the POS tile).
- **POS**: tapping or scanning a drink opens its options with the price; add a note for the barista ("very hot").
  Choose **Takeaway** or **Dine-in** (+ table number). The server checks the options (required groups, limits,
  options that belong to the drink) and prices them, so totals always match.
- Every order gets a daily **queue number** (A001, A002… restarting each day in `REPORT_TIMEZONE`), printed big on
  the receipt and shown on the customer display.
- **Barista screen** (`/kitchen`, or *Barista screen* in the menu): New → Preparing → Ready → Picked up, with options,
  notes, table, minutes waiting (amber after 5, red after 10) and a beep for new orders. Updates every 3 seconds.
- **Pickup board** (`/board?store=PP01`): put it on a TV. Shows *Preparing* and *Ready – please collect* numbers.
  It needs no login and shows only queue numbers.

Offline café sales are kept on the till and reach the barista screen when they upload, so keep the café
connected (the barista screen itself needs the server).

### Online ordering (order ahead and table QR)

Turn on **Online ordering** for the store (Stores page) and **Sell online** for products (Products page).

- **Order page**: `https://your-pos/order/PP01` (pickup). **Table QR codes**: Stores → the store → *Print table QR codes*
  prints a sheet with one QR per table (`/order/PP01?table=5`) plus an order-ahead QR.
- Customers choose drinks and options on their phone; **prices come from the server** (same options, promotions,
  coupons and tax as the POS). A phone number of a loyalty member earns points.
- **KHQR now**: the phone shows the KHQR (and can save it to pay from the same phone). In Bakong mode the payment is
  detected automatically; in manual mode the cashier presses **Online → Payment received**. Then the order goes to the
  barista screen with its queue number. Unpaid KHQR orders expire with the QR (5 minutes by default).
- **Pay at counter**: the order waits in **Online** on the POS; *Take payment* loads it into the cart.
- The customer's **status page** updates live: waiting for payment → order number → preparing → **Ready**
  (the phone vibrates). It never shows other customers' data; links are secret tokens.

Public endpoints (`/api/v1/public/...`) need no login and are rate-limited per IP (10 orders per minute).

### Member app (points, wallet, history, order ahead)

Customers open **`https://your-pos/m`** on their phone (add it to the home screen like an app).

- **Login with phone number + 6-digit code.** A new number becomes a member (asks for a name); an existing customer
  with that phone number gets their points and history. Phone numbers are stored in one format
  (`+855 12 345 678` = `012 345 678` = `012345678`), so staff can type them any way.
- **Home**: points and what they are worth, **member QR** (the cashier scans it in the POS search box to link the member),
  **wallet cards** with balance, a *Pay* QR (the cashier still asks for the card PIN) and the card history,
  and orders in progress with their queue number.
- **Order ahead** with the account: no name or phone to type, **use points** to pay part of the order, and
  **pay from the wallet** right away (no PIN: the member is logged in with a code sent to their phone). KHQR and pay at
  counter work too. Pay-at-counter orders load into the POS with the member and the chosen points.
- **History**: every receipt linked to the member, in store or online, with points earned and used, and **Order this again**.
- **Me**: name and email, log out, and *log out on all phones* (for a lost phone).
- The customer list shows an **app** tag for members who use the app.

**Sending the codes.** `MEMBER_OTP_MODE=dev` (default outside production) shows the code on the login page, for testing.
In production set `MEMBER_OTP_MODE=webhook` and `MEMBER_OTP_WEBHOOK_URL`: for each code the API POSTs
`{ "phone", "code", "message", "expiresInMinutes" }` (with `Authorization: Bearer MEMBER_OTP_WEBHOOK_SECRET` if set)
to your SMS gateway or a small script that sends the SMS. Limits: one code per number every 45 seconds, 5 per hour,
5 wrong tries per code, codes expire after 5 minutes. Member tokens are signed with their own secret and never work on
staff endpoints.

### Recipes and ingredient stock

- **Ingredients** are products marked *Ingredient* (Products → New ingredient): coffee beans (g), milk (ml), oat milk,
  syrups, cups and lids (pcs)… They have stock per store, purchase orders, transfers and low-stock alerts like any
  product, but are never sold at the POS. Cost is per unit; the *pack* helper works it out (1000 ml for $1.60 = $0.0016/ml).
- **Recipes** (Catalogue → Recipes): what one drink uses, e.g. Latte = 18 g beans + 200 ml milk + 15 ml syrup + 12oz cup + lid.
  The list shows each drink's cost and margin.
- **Options change recipes**, once for every drink that offers them:
  *Scale* (Large +30% of everything except pieces; Sugar 50% = −50% syrup), *Replace* (Oat milk replaces fresh milk;
  Large swaps the 12oz cup for a 16oz cup), *Add* (Extra shot +9 g beans). Order: base → scale → replace → add.
  *Try it* on the recipe page shows usage and cost for any combination.
- **Every sale** takes the ingredients out of stock (stock history shows *Recipe*), in the same transaction as the sale.
  A missing ingredient never blocks a sale: stock may go below zero and shows as low.
- The **real cost per cup** is saved on each sale line, so **profit reports** are right for drinks.
  **Reports → Ingredients used** shows what each store used and what it cost.
- Refunded drinks do not put ingredients back (the drink was already made).

### Bakery production (croissants, muffins, cakes)

- On the Products page turn on **Made here (bakery)**, set **pieces per batch** (e.g. 24) and **fresh for (hours)**.
  On the Recipes page give it a **batch recipe** (1 batch = 1000 g flour, 600 g butter, 2 eggs…). The cost per piece is
  batch cost ÷ pieces.
- **Catalogue → Bakery production → Today's baking** suggests how much to bake: the average sold on the same weekday
  over the last 4 weeks + 10%, minus pieces that are still fresh and batches already planned, rounded up to whole batches.
- **Bake**: "Already out of the oven" puts the pieces in stock at once; otherwise the batch is *planned* and the baker
  presses **Done** with the number of good pieces. Baking takes the ingredients out of stock (scaled to the pieces made),
  saves the **real cost per piece** on the batch and as the product's cost (so profit reports are right), and the
  batch sheet shows what was used. Selling a croissant takes a croissant from stock, not flour.
- **End of day** shows, per item, what is **expired** (pieces are counted as selling oldest first, so anything beyond the
  still-fresh batches is old; stock that was never baked through this page counts as old), what expires tonight and what
  is still good tomorrow. Adjust the numbers and **Write off**.
- **Record waste** writes off anything (a dropped cake, spilled milk, a burnt batch) with a reason.
- **Reports → Bakery production and waste**: made, sold, wasted, **waste %**, cost made and cost wasted per item,
  and waste cost by reason. Cashiers can bake and record waste in their own store; reports are for managers.
- A central kitchen can bake in its own store and send pieces to branches with **Transfers**.

## Wallet cards (store e-wallet)

Customers keep money on a store card and pay with it in any store. Points stay on the customer.

| | |
|---|---|
| **Card number** | 16 digits with a check digit (like bank cards), printed as a barcode. Starts with `WALLET_CARD_PREFIX` (default `8899`). |
| **Serial number** | Printed on the back. Needed to activate a card or move a balance to it, so a card cannot be used just by reading its number. |
| **Balance** | Money on the card. Every change is written to the card's history (top-up, payment, refund, adjustment, transfer). |
| **PIN** | Optional 4–6 digits asked when paying. 5 wrong PINs block the card. Cashiers can set a first PIN; changing one needs a manager. |

How to use it:

1. **Super admin → Wallet cards → Generate cards** downloads a CSV of card numbers and serials for the card printer
   (or register cards already printed by your supplier through `POST /wallet/cards` with `cards: [...]`).
2. **Activate** at the POS: scan an unused card → enter the serial and the customer's name → the top-up window opens.
3. **Top up** at the POS (**Top up** button): cash, KHQR, card or bank transfer. Cash top-ups are added to the
   shift's expected cash. A retried top-up is never counted twice.
4. **Pay**: scan the card (the member and balance appear), press Pay → **Wallet card** → customer types the PIN.
   If the balance is not enough, the rest can be paid by another method.
5. **Refunds** of a wallet sale can go back to the card (refund method *Wallet card*).
6. Managers can **block / unblock**, **adjust** with a reason, change the PIN, and **replace a lost card**
   (customer, balance and PIN move to a new card; the old one is closed).

The balance is taken off with one locked database update, so the same card used at two tills at once can never go
below zero. Wallet payments need a connection (the POS refuses them offline).
**Reports → Wallet cards** shows how much money customers hold on their cards: that is money the business owes them.

## Coupons and gift vouchers

The cashier scans or types any code in the POS search box. The POS works out whether it is a product, a
**wallet card**, a **gift voucher** or a **coupon** (`GET /codes/lookup`).

**Coupons** (Marketing → Coupons) are discount codes:

- **% off** (with an optional maximum) or **amount off** the whole sale, with a **minimum spend**.
- **One shared code** (e.g. `SAVE10`) or **unique single-use codes** generated in bulk (e.g. `NOV-7KQ2M9XP`) and
  downloaded as CSV for SMS, flyers or printing.
- Limits: dates, stores, **total uses**, **uses per customer**, **members only**.
- The discount is calculated on the sale after promotions and before tax, by the same file on the server and the POS
  (`pos-backend src/coupons/calc.ts`). Uses are counted inside the sale's database transaction, so a single-use code
  cannot be used twice even at two tills at the same moment.

**Gift vouchers** (Marketing → Gift vouchers) are prepaid codes (`GV...`) used as payment:

- **Sold vouchers**: printed in a batch, inactive until the cashier **sells** one at the POS (scan it → choose how the
  customer pays). Cash from voucher sales counts in the shift's expected cash.
- **Free vouchers**: promotional, usable straight away.
- Pay with **Voucher** in the payment window. What is not spent stays on the voucher; no change is given.
  Expiry dates are enforced and managers can void a voucher. Refunds can go back to the voucher.

Coupons and vouchers need a connection (they are refused offline).
**Reports** show the discount given per coupon campaign and the value of unspent sold vouchers (money you owe).

## Purchasing

**Suppliers** (shared by all stores) and **purchase orders** per store:

1. Create a draft order, or press **"Reorder low stock"** to pre-fill it with every product at or below its
   reorder level (suggested quantity = enough to reach twice the reorder level).
2. **Mark as ordered** when it is sent to the supplier (print it from the order page).
3. **Receive delivery** when goods arrive: all at once or in several deliveries. Enter the supplier invoice number
   and the real invoice cost. Stock goes up, the order becomes *Partially received* / *Received*,
   and the products' cost price is updated (so profit reports stay right).

Integrations can do the same with an API key that has `purchasing:read` / `purchasing:write`.

## Promotions

Super admins create promotions on the **Promotions** page. They apply automatically at the POS and on the server:

| Type | Example |
|---|---|
| Percent off | Drinks 10% off |
| Amount off each unit | $0.20 off each soap |
| Buy X get Y free | Buy 2 noodles, get 1 free (same product, whole units) |

Each promotion targets **all products**, chosen **categories** and/or **products**, and can be limited to
**stores**, a **start/end date**, **days of the week** and **hours** (happy hour, e.g. 17:00–19:00 or 22:00–02:00).
Times use `REPORT_TIMEZONE`. Every item gets the single best deal (priority breaks ties).
The receipt shows the promotion and the **Reports** page shows how much each promotion gave away.

The rules live in one file, `pos-backend src/promotions/engine.ts`, which **both the API and the POS import**,
so prices are identical online and offline.

## KHQR payments (Bakong)

1. On **Stores**, enter the store's **Bakong account ID** (e.g. `myshop@aclb`), the name customers see, city and bank.
   Merchant accounts also enter their merchant ID.
2. At the POS, choose **KHQR → Show KHQR**. A dynamic KHQR for the exact amount appears (valid 5 minutes,
   `KHQR_EXPIRY_MINUTES`). The customer scans it with any Cambodian banking app.
3. Confirmation:
   - `KHQR_MODE=manual` (default): the cashier checks the money arrived and presses **"Customer has paid"**.
   - `KHQR_MODE=bakong` + `BAKONG_TOKEN`: the API asks the Bakong Open API (`/v1/check_transaction_by_md5`)
     every few seconds and the sale completes by itself. The amount and currency are checked.
     Get a token at https://api-bakong.nbc.gov.kh. Managers can still confirm by hand if the API is down.
4. A QR can pay for one sale only, and only after it is paid.

The KHQR payload follows the official NBC `bakong-khqr` SDK; the tests check our generator produces exactly the
same strings as the SDK's own test cases.

## Admin web app

Log in at http://localhost:5173. The menu adapts to the user's role, and the store picker in the top bar
chooses which store you are working in.

| Page | What you can do | Who |
|---|---|---|
| Dashboard | Today vs yesterday, 30-day sales chart, top products, low stock, my shift | everyone (charts: managers) |
| Reports | Sales by day/week/month/store, profit, top products, payment methods, cashiers, loyalty, stock value, CSV export | managers |
| Sales | Search receipts, view and print a receipt, refund items, void a sale from today | everyone (cashiers refund / void with a manager PIN) |
| Shifts | Open and close a cash drawer shift, see expected vs counted cash | everyone |
| Customers | Members, points balance, purchase and points history, adjust points | everyone (adjust: managers) |
| Products | Catalogue with store price, margin and stock | everyone (edit: super admin) |
| Categories | Category tree | super admin |
| Inventory | Stock levels, low-stock filter, receive goods, adjust stock, store price and reorder level, stock history | managers |
| Transfers | Send stock to another store, receive or cancel | managers |
| Users | Staff accounts, roles and store assignment | managers (cashiers only) / super admin |
| Stores | Branches, tax rate, currency | super admin |
| Integrations | API keys and webhooks with delivery log, test and retry | super admin |

For production, build it with `npm run build:web` and serve `dist` with Nginx,
forwarding `/api` to the API server. All routes should fall back to `index.html`.

## Cash drawer: cash in / out, X and Z reports

- **Cash in / out** (POS top bar): money put into the drawer (extra float, change from the bank) or taken out
  (supplier paid in cash, bank drop), in dollars or riel, always with a reason. Cashier **cash-outs need a manager
  PIN** (store setting *Cashier cash-outs need a manager PIN*); the PIN approves that amount only. You cannot take out
  more than the drawer should hold. The shift's expected dollar and riel drawers include these moves.
- **X report** (POS top bar, or Shifts → a shift): the shift so far — sales, gross, promotions, coupons, manual
  discounts, tax, points, net, refunds and voids, payments by method (riel cash with the riel amount), wallet top-ups,
  vouchers sold, every cash in / out with who approved it, the dollar and riel drawer, top items and sales by hour.
  It changes nothing and can be printed any time (80 mm).
- **Z report** (Selling → End of day (Z), managers): closes a store's business day. Every shift opened that day must
  be closed first. The Z gets the next number for the store (**PP01-Z0001**, …), the figures are saved and never
  change, and the day cannot be closed twice. It adds each shift's expected, counted and over / short, and sales by
  cashier. *Preview* shows the figures before closing; past Z reports can be reprinted from the list.

## Khmer interface (ខ្មែរ)

- The **ខ្មែរ / EN** button (login page, top bar, POS, online order page, member app) switches the language. The
  choice is kept on the device; a phone set to Khmer starts in Khmer. The customer display follows the POS.
- **Khmer names for products and categories** (Products / Categories: *Khmer name*) are shown on the POS, the online
  menu, the customer display, member history and receipts when the screen is in Khmer. The receipt keeps the Khmer
  name of the time of sale.
- All Khmer text is in **one file**: `src/i18n/km.ts` (English text → Khmer). Anything not in the file stays
  in English, so you can add or correct wording without touching the screens. Please have a native speaker review it.
  The POS, payment, receipts, customer display, online ordering, member app, menu, login, shifts and the most used
  admin text are translated; long admin help texts and messages from the server are still English.
- Font: Kantumruy Pro (Google Fonts), falling back to the computer's Khmer font when offline.

## USD / KHR dual currency (cash in dollars and riel)

- **Stores → Riel cash**: turn it on and set the **exchange rate** (riel per $1, e.g. 4100). Prices, reports and
  card / KHQR payments stay in dollars; riel is for cash. Riel is always rounded to **100 riel** (no coins).
- The POS cart and the customer display show the total in riel too (rounded **up**, so the customer never pays less).
- **Pay**: *Cash $* and *Cash ៛* are separate methods with their own note buttons (៛1,000 … ៛100,000), and can be
  mixed (e.g. $2 + ៛7,600). The riel paid is saved with the rate used; the server checks its dollar value
  (offline tills may use a rate up to 5% old).
- **Change**: *$ + ៛* (whole dollars in USD, the rest in riel, the usual way), *All ៛* or *All $*. The choice is
  remembered on the till. Receipts show the riel paid, the change in both currencies and the rate.
- **Shifts** have two drawers: dollars and riel. Opening, expected and counted riel (riel received − riel change),
  with the difference when the shift is closed.

The shared rounding rules are in `pos-backend src/sales/cash.ts` (used by both the API and the POS).

## Cashier controls (discount limit, manager PIN, refunds, voids, audit log)

- **Discount limit per store** (Stores → Cashier controls, default 10%): a cashier's manual discounts (line and whole
  sale together, as % of the sale after promotions) above the limit need a **manager PIN** when paying. Promotions,
  coupons and points do not count. Managers have no limit. Over-limit discounts cannot be given offline.
- **Manager PIN**: each manager sets their own 4–8 digit PIN with the key button in the top bar (needs their password;
  easy PINs like 1111 or 1234 and PINs another manager already uses are refused). On the cashier's screen the manager
  types it on a keypad. The approval is for that action only (that discount %, that sale), works once, for 5 minutes.
  Five wrong PINs lock that cashier's requests for 15 minutes. A manager of another store cannot approve.
- **Refunds**: cashiers can now refund from Sales with a manager PIN (or without one if the store turns
  *Cashier refunds need a manager PIN* off).
- **Void**: cancels a whole sale from today that has not been refunded and was paid one way. Stock, points, coupon and
  wallet are put back, the money goes back the way it was paid, and the sale shows as *Voided*. Cashiers need a PIN
  (store setting). Older or part-refunded sales use Refund.
- **Audit log** (Administration → Audit log, managers): manual discounts (and who approved them), PIN approvals and
  wrong PINs, refunds and voids with reasons, price changes, stock adjustments, points and wallet adjustments, wallet
  blocks, user and store changes, logins and failed logins. Quick filters for discounts, refunds, voids, wrong PINs
  and failed logins; click a row for the details. Entries are never edited.

Demo PINs: manager.pp **2580**, manager.sr **1397**, admin **9024**.
