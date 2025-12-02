const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const Anthropic = require('@anthropic-ai/sdk')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 3000

// ====== Database ======
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// Initialize database schema (runs once)
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log('✓ Users table ready')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log('✓ Chats table ready')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log('✓ Messages table ready')
  } catch (err) {
    console.error('Database init error:', err.message)
  }
}

// ====== Middleware ======
app.use(cors())
app.use(express.json())
app.use(express.static('.'))

// Auth middleware
function verifyToken(req, res, next) {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: 'No token' })
  
  const token = auth.split(' ')[1]
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key')
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// ====== Auth Endpoints ======
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    
    const hash = await bcrypt.hash(password, 10)
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hash]
    )
    
    const user = result.rows[0]
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev_secret_key'
    )
    
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } })
  } catch (err) {
    console.error('Signup error:', err)
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' })
    }
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' })
    }
    
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    
    const user = result.rows[0]
    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev_secret_key'
    )
    
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ====== Chat Endpoint (Claude Integration) ======
const client = new Anthropic()

app.post('/api/chat', verifyToken, async (req, res) => {
  try {
    const { message } = req.body
    const userId = req.user.userId
    
    if (!message) {
      return res.status(400).json({ error: 'No message provided' })
    }
    
    // Placeholder: You can store message history for context if needed
    // For now, send a simple request to Claude
    
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: 'You are Ellerslie School AI, a helpful tutor designed for school students. Help with homework, explain concepts clearly, suggest study tips, and encourage learning. Keep responses focused and under 500 words.',
      messages: [
        {
          role: 'user',
          content: message
        }
      ]
    })
    
    const reply = response.content[0].type === 'text' ? response.content[0].text : 'Could not understand response'
    
    res.json({ reply })
  } catch (err) {
    console.error('Chat error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ====== Health Check ======
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// ====== Serve Frontend ======
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html')
})

// ====== Start Server ======
async function start() {
  try {
    await initDb()
    app.listen(port, () => {
      console.log(`✓ Server running at http://localhost:${port}`)
      console.log(`✓ API base: http://localhost:${port}/api`)
    })
  } catch (err) {
    console.error('Startup error:', err)
    process.exit(1)
  }
}

start()
