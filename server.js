import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import ImageKit from "imagekit";
import multer from "multer";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;



// Middleware

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
"https://prismatic-narwhal-780e93.netlify.app"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));


app.use(express.json());

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC,
  privateKey: process.env.IMAGEKIT_PRIVATE,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phone: String,
  dateOfBirth: Date,
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String
  },
  awcCode: { type: String, unique: true }, // <-- NEW
  avatar: { type: String }, // 🔹 Store ImageKit URL

  createdAt: { type: Date, default: Date.now }
});

// Account Schema
const accountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountNumber: { type: String, required: true, unique: true },
  accountType: { type: String, enum: ['checking', 'savings', 'credit'], required: true },
  balance: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'inactive', 'frozen'], default: 'active' },
  createdAt: { type: Date, default: Date.now }
});

// Transaction Schema
const transactionSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  accountId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Account', 
    required: true 
  },
  type: { 
    type: String, 
    enum: ['deposit', 'withdrawal', 'transfer', 'payment', 'crypto'], 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  description: String,

  // Fiat payments
  recipientAccount: String,
  recipientName: String,

  // Crypto-specific fields
  cryptoType: { 
    type: String, 
    enum: ['BTC', 'ETH', 'USDT'], 
    required: function () { return this.type === 'crypto'; } 
  },
  recipientAddress: { 
    type: String, 
    required: function () { return this.type === 'crypto'; } 
  },
  networkFee: { 
    type: Number, // store numeric fee in same currency as amount
    required: false 
  },
  network: { 
    type: String, // e.g. "Ethereum", "Tron", "Bitcoin mainnet"
    required: false 
  },

  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed'], 
    default: 'completed' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});


// Card Schema
const cardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  cardNumber: { type: String, required: true },
  cardType: { type: String, enum: ['debit', 'credit'], required: true },
  expiryDate: { type: String, required: true },
  cvv: { type: String, required: true },
  status: { type: String, enum: ['active', 'blocked', 'expired'], default: 'active' },
  creditLimit: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Account = mongoose.model('Account', accountSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Card = mongoose.model('Card', cardSchema);

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET || 'banking_secret_key', (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Generate account number
const generateAccountNumber = () => {
  return '1234' + Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
};

// Generate card number
const generateCardNumber = () => {
  return '4532' + Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
};

function generateAWCCode() {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `AWC-${randomPart}`;
}


// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const awcCode = generateAWCCode();

    const user = new User({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      phone,
      awcCode // assign here
    });

    await user.save();

    // Create default checking account
    const checkingAccount = new Account({
      userId: user._id,
      accountNumber: generateAccountNumber(),
      accountType: 'checking',
      balance: 1000 // Initial balance
    });
    await checkingAccount.save();

    // Create default savings account
    const savingsAccount = new Account({
      userId: user._id,
      accountNumber: generateAccountNumber(),
      accountType: 'savings',
      balance: 5000 // Initial balance
    });
    await savingsAccount.save();

    // Create debit card
    const debitCard = new Card({
      userId: user._id,
      accountId: checkingAccount._id,
      cardNumber: generateCardNumber(),
      cardType: 'debit',
      expiryDate: '12/28',
      cvv: Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    });
    await debitCard.save();

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'banking_secret_key');

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        awcCode: user.awcCode // return it in response
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'banking_secret_key');
    
    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Account routes
app.get('/api/accounts', authenticateToken, async (req, res) => {
  try {
    const accounts = await Account.find({ userId: req.user.userId });
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Transaction routes
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/transactions/transfer', authenticateToken, async (req, res) => {
  try {
    const { 
      fromAccountId, 
      toAccount,          // for fiat transfers (account number / IBAN)
      amount, 
      description, 
      transferType,       // "internal" | "swift" | "sepa" | "crypto"
      cryptoType,         // required if crypto
      recipientAddress,   // required if crypto
      networkFee,         // optional for crypto
      network             // optional for crypto (Ethereum, Bitcoin, Tron, etc.)
    } = req.body;

    // Validate sender account
    const fromAccount = await Account.findOne({
      _id: fromAccountId,
      userId: req.user.userId
    });

    if (!fromAccount || fromAccount.balance < amount) {
      return res.status(400).json({ message: 'Insufficient funds' });
    }

    // Deduct from sender
    await Account.findByIdAndUpdate(fromAccountId, {
      $inc: { balance: -amount }
    });

    let toAccountDoc = null;
    let transactionPayload = {
      userId: req.user.userId,
      accountId: fromAccountId,
      amount,
      description: description || 'Money Transfer',
      status: 'completed'
    };

    if (transferType === 'internal') {
      // Find recipient account inside same user
      toAccountDoc = await Account.findOne({
        accountNumber: toAccount,
        userId: req.user.userId
      });

      if (!toAccountDoc) {
        return res.status(404).json({ message: 'Recipient account not found' });
      }

      // Add to recipient balance
      await Account.findByIdAndUpdate(toAccountDoc._id, {
        $inc: { balance: amount }
      });

      transactionPayload = {
        ...transactionPayload,
        type: 'transfer',
        recipientAccount: toAccount
      };
    } 
    
    else if (transferType === 'crypto') {
      // Crypto transfer – don’t look for internal account
      if (!cryptoType || !recipientAddress) {
        return res.status(400).json({ message: 'Crypto type and recipient address are required' });
      }

      transactionPayload = {
        ...transactionPayload,
        type: 'crypto',
        cryptoType,
        recipientAddress,
        networkFee: networkFee || 0,
        network: network || null
      };
    } 
    
    else {
      // External fiat transfer (SWIFT / SEPA)
      transactionPayload = {
        ...transactionPayload,
        type: 'transfer',
        recipientAccount: toAccount
      };
    }

    // Save transaction
    const transaction = new Transaction(transactionPayload);
    await transaction.save();

    res.json({
      message: 'Transfer completed successfully',
      transaction,
      updatedFrom: fromAccountId,
      updatedTo: toAccountDoc?._id || null
    });

  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});



// Card routes
app.get('/api/cards', authenticateToken, async (req, res) => {
  try {
    const cards = await Card.find({ userId: req.user.userId }).populate('accountId');
    res.json(cards);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Dashboard stats
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const accounts = await Account.find({ userId: req.user.userId });
    const transactions = await Transaction.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(10);
    
    const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);
    const monthlySpending = await Transaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.user.userId),
          type: { $in: ['withdrawal', 'payment', 'transfer'] },
          createdAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);
    
    res.json({
      totalBalance,
      accountCount: accounts.length,
      monthlySpending: Math.abs(monthlySpending[0]?.total || 0),
      recentTransactions: transactions
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Profile routes
app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const { firstName, lastName, phone, dateOfBirth, address } = req.body;



    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      {
        firstName,
        lastName,
        phone,
        dateOfBirth,
        address,
      },
      { new: true, runValidators: true }
    ).select('-password');


    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update profile', error: error.message });
  }
});


app.put('/api/user/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to change password', error: error.message });
  }
});

// Get current user's profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch profile', error: error.message });
  }
});

app.post("/upload-avatar", authenticateToken, upload.single("avatar"), async (req, res) => {
  try {
    const userId = req.user.id;

    const uploadedImage = await imagekit.upload({
      file: req.file.buffer, // file buffer
      fileName: `${userId}-avatar.jpg`,
      folder: "/avatars"
    });

    // Save URL to user profile
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { avatar: uploadedImage.url },
      { new: true }
    );

    res.json({ success: true, avatar: updatedUser.avatar });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Avatar upload failed" });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});