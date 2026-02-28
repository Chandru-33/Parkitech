# Smart Parking Middleman (Node + Express + EJS)

This is a simple full-stack demo application that acts as a **middleman** between:

- **Clients**: people who have parking space to share.
- **Users**: people who want to rent parking temporarily.

Clients register and list parking spaces with details like address, vehicle type, available time window, and price. Users register, search for available spaces, book them for a time range, and receive a **payment receipt** plus a **Google Maps link** from their current location to the booked parking address.

## Tech stack

- **Backend**: Node.js, Express
- **Views**: EJS templates
- **Database**: SQLite (file `parking.db` in the project root)
- **Auth**: Simple email/password with sessions (passwords hashed with bcrypt)

## Project structure

- `server.js` – main Express server and routes
- `db.js` – SQLite database initialization (users, parking_spaces, bookings)
- `views/` – EJS templates
  - `layout.ejs` – shared layout
  - `index.ejs` – landing page
  - `register.ejs`, `login.ejs`
  - `client_dashboard.ejs`, `parking_new.ejs`
  - `user_dashboard.ejs`, `booking_new.ejs`, `booking_confirm.ejs`
- `public/styles.css` – basic modern UI styling
- `parking.db` – SQLite database file (created automatically on first run)

## Setup

1. **Open a terminal** in the project folder:

   ```bash
   cd "c:\Users\USER\OneDrive\Documents\newwwwww"
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Start the server**:

   ```bash
   npm start
   ```

4. Open `http://localhost:3000` in your browser.

## Application walkthrough

1. **Register / login**
   - Go to `Register`.
   - Enter your name, email, password.
   - Choose your role:
     - **Client** – you have a parking space to share.
     - **User** – you want to rent parking temporarily.
   - After registering, you are logged in and redirected based on your role.

2. **Client flow (parking space owner)**
   - After login as **client**, you land on `My parking spaces` dashboard.
   - Click **Add new space** and fill in:
     - Name/title of the space
     - Address
     - Location description / landmarks
     - What type of vehicle can be parked (two-wheeler, four-wheeler, both)
     - How many vehicles can be parked (total slots)
     - From which time to which time the parking is available
     - Price per hour
   - The space is saved and appears in your list.

3. **User flow (parking renter)**
   - After login as **user**, you land on `Find parking` dashboard.
   - You can:
     - Search by location / address / landmark.
     - Filter by vehicle type.
   - A list of matching parking spaces is displayed with:
     - Owner name
     - Address and location description
     - Vehicle type, total slots
     - Available time window
     - Price per hour
   - Click **Book this space** to go to the booking screen.

4. **Booking, payment receipt and Google Maps link**
   - On the booking page, choose:
     - Start date & time
     - End date & time
   - Submit to simulate payment and create a booking.
   - You are shown:
     - A **payment receipt** (booking id, parking space, address, period, total amount).
     - A **Google Maps directions link** that opens:
       - `https://www.google.com/maps/dir/?api=1&destination=<parking_address>`
       - On your phone or browser, Google Maps will use your current location as the origin.
   - You can also print the receipt.

## Notes

- This is a demo, so the "payment" is simulated – there is no real payment gateway.
- Basic validation is added, but you can extend it as needed.
- You can freely modify styles in `public/styles.css` or add JS as needed.

