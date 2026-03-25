require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function runSqlFile(connection, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  // 按分号拆分语句，过滤空语句
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    await connection.query(stmt);
    console.log(`  [OK] ${stmt.substring(0, 60).replace(/\n/g, ' ')}...`);
  }
}

async function main() {
  // 先用无数据库连接创建 db02
  const connRoot = await mysql.createConnection({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  console.log('=== Step 1: 创建数据库 db02 ===');
  await runSqlFile(connRoot, path.join(__dirname, '../sql/01_create_db.sql'));
  await connRoot.end();

  // 切换到 db02 数据库连接
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    multipleStatements: false,
  });

  console.log('\n=== Step 2: 创建数据表 ===');
  await runSqlFile(conn, path.join(__dirname, '../sql/02_create_tables.sql'));

  console.log('\n=== Step 3: 插入虚拟测试数据 ===');
  await runSqlFile(conn, path.join(__dirname, '../sql/03_insert_test_data.sql'));

  // 验证
  console.log('\n=== Step 4: 验证结果 ===');
  const [depts] = await conn.query('SELECT id, name, level, parent_id FROM department ORDER BY level, sort_order');
  console.log(`\n部门表共 ${depts.length} 条记录：`);
  depts.forEach(d => console.log(`  [level${d.level}] id=${d.id}  ${d.name}  parent_id=${d.parent_id ?? 'NULL'}`));

  const [persons] = await conn.query('SELECT id, username, class, job, dept_id FROM person ORDER BY class');
  console.log(`\n人员表共 ${persons.length} 条记录：`);
  persons.forEach(p => console.log(`  [class${p.class}] ${p.username}  ${p.job}  dept_id=${p.dept_id}`));

  await conn.end();
  console.log('\n任务一完成！');
}

main().catch(err => {
  console.error('执行失败：', err.message);
  process.exit(1);
});
