require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS files (
      id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
      filename      VARCHAR(255)    NOT NULL                  COMMENT '文件名',
      original_name VARCHAR(255)    NOT NULL                  COMMENT '原始文件名',
      file_type     VARCHAR(20)     NOT NULL                  COMMENT '文件类型',
      file_ext      VARCHAR(20)     NOT NULL                  COMMENT '文件扩展名',
      description   TEXT            NULL                      COMMENT '文件描述',
      file_size     BIGINT UNSIGNED NOT NULL                  COMMENT '文件大小（字节）',
      s3_key        VARCHAR(500)    NOT NULL                  COMMENT 'S3存储路径',
      s3_url        VARCHAR(1000)   NOT NULL                  COMMENT 'S3访问URL',
      uploader_id   INT UNSIGNED    NOT NULL                  COMMENT '上传人ID',
      dept_id       INT UNSIGNED    NOT NULL                  COMMENT '上传人部门ID',
      status        TINYINT         NOT NULL DEFAULT 1         COMMENT '状态：1=正常 0=删除',
      created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      FOREIGN KEY (uploader_id) REFERENCES person(id) ON DELETE RESTRICT,
      FOREIGN KEY (dept_id) REFERENCES department(id) ON DELETE RESTRICT,
      INDEX idx_file_type (file_type),
      INDEX idx_uploader (uploader_id),
      INDEX idx_dept (dept_id),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件表'
  `);

  console.log('files 表创建成功');
  await conn.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
