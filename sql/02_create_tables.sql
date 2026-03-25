USE db02;

-- =====================
-- 部门表
-- =====================
CREATE TABLE IF NOT EXISTS department (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100)  NOT NULL                  COMMENT '部门名称',
  level       TINYINT       NOT NULL                  COMMENT '层级：1=公司 2=一级部门 3=二级部门 4=三级部门',
  parent_id   INT UNSIGNED  NULL                      COMMENT '父部门ID，NULL表示顶层公司',
  sort_order  SMALLINT      NOT NULL DEFAULT 0         COMMENT '同级排序号',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (parent_id) REFERENCES department(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部门表';

-- =====================
-- 人员表
-- =====================
CREATE TABLE IF NOT EXISTS person (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username    VARCHAR(50)   NOT NULL UNIQUE            COMMENT '登录用户名',
  password    VARCHAR(100)  NOT NULL                  COMMENT '登录密码（明文）',
  real_name   VARCHAR(50)   NOT NULL                  COMMENT '真实姓名',
  class       INT           NOT NULL DEFAULT 9         COMMENT '用户级别：数字越小级别越高，0=admin，1=总经理，2=一级部门经理，依此类推',
  job         VARCHAR(100)  NOT NULL                  COMMENT '工作岗位',
  dept_id     INT UNSIGNED  NOT NULL                  COMMENT '所属部门ID',
  phone       VARCHAR(20)   NULL                      COMMENT '手机号',
  email       VARCHAR(100)  NULL                      COMMENT '电子邮箱',
  status      TINYINT       NOT NULL DEFAULT 1         COMMENT '状态：1=在职 0=离职',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (dept_id) REFERENCES department(id) ON DELETE RESTRICT,
  CONSTRAINT chk_phone CHECK (
    phone IS NULL OR phone REGEXP '^1[3-9][0-9]{9}$'
  ),
  CONSTRAINT chk_email CHECK (
    email IS NULL OR email REGEXP '^[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}$'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人员表';
