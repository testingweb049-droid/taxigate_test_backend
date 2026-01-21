
## ⚡ Quick Start

1️⃣ **Clone the repository:**
```bash

npm install
npm run dev    # For development
npm start      # For production

🛡️ Safety Notes
npm run db:clear and npm run db:reset will delete all data (with confirmation).
Always review .env settings before running in production.
Use npm run db:migrate for safe schema updates.


| Command              | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `npm run dev`        | Starts the server in development mode (with Nodemon)       |
| `npm start`          | Starts the server in production mode                       |
| `npm run db:migrate` | Syncs database schema (safe, no data loss)                 |
| `npm run db:seed`    | Inserts seed/test data                                     |
| `npm run db:clear`   | ⚠️ Clears all collections (with confirmation)              |
| `npm run db:reset`   | Clears + Migrates + Seeds the database (with confirmation) |
| `npm run lint`       | Runs ESLint to check code quality                          |
| `npm run format`     | Auto-formats code using Prettier                           |
| `npm test`           | Runs tests using Jest                                      |




🛠️ Features
✅ JWT Authentication with Roles & Permissions
✅ Product & Category Management
✅ Cloudinary + Multer for Image Uploads
✅ Security Middleware (Helmet, XSS Clean, Rate Limiting)
✅ Logging with Winston + Daily Rotate
✅ Testing Setup (Jest + Supertest)
✅ Easy Database Scripts (Clear, Seed, Reset)
✅ Prettier + ESLint for Code Quality




## Environment Variables (.env)

```env
# Database
MONGO_URI=mongodb://localhost:27017/taxigate

# JWT Authentication
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_jwt_refresh_secret (optional, defaults to JWT_SECRET)
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=7d

# Email Configuration
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your_email
EMAIL_PASS=your_password

# Cloudinary (Image Upload)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Ably (Real-time Notifications)
ABLY_API_KEY=your_ably_api_key
ABLY_CLIENT_ID=server (optional, defaults to "server")

# Firebase (Push Notifications)
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_PRIVATE_KEY=your_firebase_private_key
FIREBASE_CLIENT_EMAIL=your_firebase_client_email

# File Upload Limits
DRIVER_DOCUMENT_MAX_SIZE_MB=5 (optional, defaults to 5MB)
DRIVER_DOCUMENT_MAX_TOTAL_SIZE_MB=50 (optional, defaults to 50MB)

# Driver Commission
DRIVER_COMMISSION_PERCENTAGE=22 (optional, defaults to 22%)
# This percentage is deducted from the booking price to calculate the driver's earnings
# Example: If booking price is €100 and commission is 22%, driver receives €78

# Order/Ride Number Prefix
ORDER_NUMBER_PREFIX=RID (optional, defaults to "RID")
# Prefix for unique order/ride numbers generated for each booking
# Format: {PREFIX}-{NUMBER}
# Example: RID-1000, RID-1001, RID-1002, etc.
# Numbers start from 1000 and increment sequentially

# Server
PORT=5000 (optional, defaults to 5000)
NODE_ENV=development (development/production/test)


🤝 Contributing

Fork the repository
Create a feature branch: git checkout -b feature/my-feature
Commit changes: git commit -m "Added a new feature"
Push branch: git push origin feature/my-feature
Open a Pull Request