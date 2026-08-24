module.exports = {
  name: '001_initial_pos_schema',
  async up(connection) {
    // 1. Restaurants Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        domain VARCHAR(100) UNIQUE,
        logo_url VARCHAR(255),
        address TEXT,
        phone VARCHAR(20),
        email VARCHAR(100),
        owner_name VARCHAR(100),
        owner_email VARCHAR(100),
        owner_mobile VARCHAR(20),
        gst_number VARCHAR(20),
        subscription_plan_id INT DEFAULT 1,
        subscription_status ENUM('active', 'expired', 'suspended', 'trial') DEFAULT 'trial',
        subscription_expires_at DATETIME,
        max_user_limit INT DEFAULT 5,
        max_manager_limit INT DEFAULT 2,
        max_cashier_limit INT DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Users Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT,
        name VARCHAR(100) NOT NULL,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(100),
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('super_admin', 'admin', 'manager', 'cashier') DEFAULT 'cashier',
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        UNIQUE KEY uq_rest_username (restaurant_id, username),
        KEY idx_user_role (role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Categories Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(50) NOT NULL,
        description TEXT,
        seq INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. Menu Items Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        category_id INT,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        is_veg TINYINT(1) DEFAULT 1,
        is_available TINYINT(1) DEFAULT 1,
        image_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. Table Types & Tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS table_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(50) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS tables (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        type_id INT,
        table_number VARCHAR(20) NOT NULL,
        capacity INT DEFAULT 4,
        status ENUM('available', 'occupied', 'reserved') DEFAULT 'available',
        active_order_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        FOREIGN KEY (type_id) REFERENCES table_types(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 6. Orders Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        order_number VARCHAR(50) NOT NULL,
        table_id INT,
        cashier_id INT,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        order_type ENUM('dine_in', 'takeaway', 'delivery') DEFAULT 'dine_in',
        status ENUM('active', 'completed', 'cancelled') DEFAULT 'active',
        subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        tax_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        payment_method ENUM('cash', 'card', 'upi', 'due', 'other') DEFAULT 'cash',
        payment_status ENUM('pending', 'completed', 'failed') DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE SET NULL,
        FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 7. Order Items Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        menu_item_id INT,
        item_name VARCHAR(100) NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        total_price DECIMAL(10, 2) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }
};
