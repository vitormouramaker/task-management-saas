require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const bcrypt = require('bcrypt');
const { postgres } = require('./connect');
const crypto = require('crypto');

async function seedAdmin() {
  const client = await postgres.connect();
  try {
    const email = process.env.SEED_ADMIN_EMAIL;
    const plainPassword = process.env.SEED_ADMIN_PASSWORD;

    if (!email || !plainPassword) {
      console.error('Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no ambiente para rodar o seed.');
      process.exit(1);
    }

    // Verificar se o usuário já existe
    const res = await client.query('SELECT * FROM members WHERE email = $1', [email]);
    if (res.rows.length > 0) {
      console.log('O usuário admin já existe no banco.');
      process.exit(0);
    }

    // Criar o hash da senha
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(plainPassword, saltRounds);
    
    // Gerar um ID único simples
    const id = 'admin_' + crypto.randomBytes(8).toString('hex');

    // Inserir na tabela
    await client.query(
      `INSERT INTO members (id, name, role, email, password_hash, avatar_color) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, 'Administrador', 'Administrador', email, passwordHash, 'bg-blue-600']
    );

    console.log('✅ Usuário admin criado com sucesso!');
    console.log(`Email: ${email}`);
  } catch (err) {
    console.error('❌ Erro ao criar o usuário admin:', err);
  } finally {
    client.release();
    process.exit(0);
  }
}

seedAdmin();
