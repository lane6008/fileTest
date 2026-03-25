require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// 解析 JSON 请求体
app.use(express.json());
// 提供 public 目录下的静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 创建数据库连接池
const pool = mysql.createPool({
  host:            process.env.DB_HOST,
  port:            parseInt(process.env.DB_PORT) || 3306,
  user:            process.env.DB_USER,
  password:        process.env.DB_PASSWORD,
  database:        process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

// 登录接口
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: '用户名或密码不能为空！' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, username, real_name FROM person WHERE username = ? AND password = ? AND status = 1',
      [username, password]
    );

    if (rows.length > 0) {
      res.json({ success: true, message: '登录成功', user: { id: rows[0].id, name: rows[0].real_name } });
    } else {
      res.json({ success: false, message: '用户名或密码不匹配，请重新输入！' });
    }
  } catch (err) {
    console.error('数据库查询错误：', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请联系管理员。' });
  }
});

app.listen(PORT, () => {
  console.log(`服务已启动：http://localhost:${PORT}`);
});
