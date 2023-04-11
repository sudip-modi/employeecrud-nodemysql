const express = require("express");
const mysql = require("mysql");
const redis = require("redis");

const app = express();
const redisClient = redis.createClient();

/**
 * @typedef {Object} Contact
 * @property {string} type - The type of contact (e.g. phone, email, address)
 * @property {string} value - The value of the contact (e.g. +1 (555) 123-4567, john.doe@example.com, 123 Main St.)
 */

/**
 * @typedef {Object} Employee
 * @property {number} id - The ID of the employee
 * @property {string} name - The name of the employee
 * @property {string} email - The email of the employee
 * @property {Contact[]} contacts - The contacts of the employee
 */

/**
 * Fetches all employees from the database
 * @param {function} callback - The callback function that handles the result
 */
function getAllEmployees(callback) {
  // Check cache first
  redisClient.get("employees", (err, result) => {
    if (err) throw err;

    if (result !== null) {
      // Cache hit, return employees from cache
      const employees = JSON.parse(result);
      callback(null, employees);
    } else {
      // Cache miss, fetch employees from database
      connection.query("SELECT * FROM employees", (err, results) => {
        if (err) throw err;
        const employees = results.map((result) => ({
          id: result.id,
          name: result.name,
          email: result.email,
        }));
        const employeesJson = JSON.stringify(employees);

        // Cache employees for 5 minutes
        redisClient.setex("employees", 300, employeesJson, (err, result) => {
          if (err) throw err;
          console.log(`Cached employees for 5 minutes`);
          callback(null, employees);
        });
      });
    }
  });
}

/**
 * Fetches an employee by ID from the database
 * @param {number} employeeId - The ID of the employee to fetch
 * @param {function} callback - The callback function that handles the result
 */
function getEmployeeById(employeeId, callback) {
  // Fetch employee from database
  connection.query(
    "SELECT * FROM employees WHERE id = ?",
    [employeeId],
    (err, results) => {
      if (err) throw err;

      if (results.length === 0) {
        // Employee not found
        callback(null, null);
      } else {
        const employee = results[0];

        // Fetch contacts for employee from database
        connection.query(
          "SELECT * FROM contacts WHERE employee_id = ?",
          [employeeId],
          (err, results) => {
            if (err) throw err;

            const contacts = results.map((result) => ({
              type: result.type,
              value: result.value,
            }));

            const employeeWithContacts = {
              id: employee.id,
              name: employee.name,
              email: employee.email,
              contacts,
            };

            callback(null, employeeWithContacts);
          }
        );
      }
    }
  );
}

/**
 * Creates a new employee and their contacts in the database
 * @param {Employee} employee - The employee to create
 * @param {function} callback - The callback function that handles the result
 */
function createEmployee(employee, callback) {
  // Insert employee into database
  connection.query("INSERT INTO employees SET ?", employee, (err, result) => {
    if (err) throw err;

    const employeeId = result.insertId;

    // Insert contacts for employee into database
    const contacts = employee.contacts.map((contact) => ({
      employee_id: employeeId,
      type: contact.type,
      value: contact.value,
    }));

    connection.query("INSERT INTO contacts SET ?", contacts, (err, result) => {
      if (err) throw err;
      console.log(`Created employee with ID ${employeeId}`);

      // Invalidate cache
      redisClient.del("employees", (err, result) => {
        if (err) throw err;
        console.log(`Invalidated employees cache`);
        callback(null, employeeId);
      });
    });
  });
}

/**

Updates an employee and their contacts in the database

@param {number} employeeId - The ID of the employee to update

@param {Employee} employee - The employee data to update

@param {function} callback - The callback function that handles the result
*/
function updateEmployee(employeeId, employee, callback) {
  // Update employee in database
  connection.query(
    "UPDATE employees SET ? WHERE id = ?",
    [employee, employeeId],
    (err, result) => {
      if (err) throw err;

      // Delete existing contacts for employee in database
      connection.query(
        "DELETE FROM contacts WHERE employee_id = ?",
        [employeeId],
        (err, result) => {
          if (err) throw err;

          // Insert new contacts for employee into database
          const contacts = employee.contacts.map((contact) => ({
            employee_id: employeeId,
            type: contact.type,
            value: contact.value,
          }));

          connection.query(
            "INSERT INTO contacts SET ?",
            contacts,
            (err, result) => {
              if (err) throw err;
              console.log(`Updated employee with ID ${employeeId}`);

              // Invalidate cache
              redisClient.del("employees", (err, result) => {
                if (err) throw err;
                console.log(`Invalidated employees cache`);
                callback(null);
              });
            }
          );
        }
      );
    }
  );
}

/**

Deletes an employee and their contacts from the database

@param {number} employeeId - The ID of the employee to delete

@param {function} callback - The callback function that handles the result
*/
function deleteEmployee(employeeId, callback) {
  // Delete employee from database
  connection.query(
    "DELETE FROM employees WHERE id = ?",
    [employeeId],
    (err, result) => {
      if (err) throw err;

      // Delete contacts for employee from database
      connection.query(
        "DELETE FROM contacts WHERE employee_id = ?",
        [employeeId],
        (err, result) => {
          if (err) throw err;
          console.log(`Deleted employee with ID ${employeeId}`);

          // Invalidate cache
          redisClient.del("employees", (err, result) => {
            if (err) throw err;
            console.log("Invalidated employees cache");
            callback(null);
          });
        }
      );
    }
  );
}

// Middleware for parsing JSON request bodies
app.use(express.json());

/**
 * GET all employees endpoint with pagination.
 *
 * @name GET/api/employees
 * @function
 * @memberof module:routes/employees
 * @inner
 * @param {object} req - The HTTP request object.
 * @param {object} res - The HTTP response object.
 * @returns {void}
 */
app.get("/employees", (req, res) => {
  const page = req.query.page || 1;
  const limit = req.query.limit || 10;
  const startIndex = (page - 1) * limit;

  getAllEmployees((err, employees) => {
    if (err) {
      res.status(500).send("Error fetching employees");
    } else {
      const paginatedEmployees = employees.slice(
        startIndex,
        startIndex + parseInt(limit)
      );
      res.json(paginatedEmployees);
    }
  });
});

// GET employee by ID endpoint
app.get("/employees/:id", (req, res) => {
  const employeeId = req.params.id;

  getEmployeeById(employeeId, (err, employee) => {
    if (err) {
      res.status(500).send(`Error fetching employee with ID ${employeeId}`);
    } else if (!employee) {
      res.status(404).send(`Employee with ID ${employeeId} not found`);
    } else {
      res.send(employee);
    }
  });
});

/**
 * POST create employee endpoint.
 *
 * @name POST/api/employees
 * @function
 * @memberof module:routes/employees
 * @inner
 * @param {object} req - The HTTP request object.
 * @param {object} res - The HTTP response object.
 * @returns {void}
 */
app.post("/employees", (req, res) => {
  const employee = req.body;

  createEmployee(employee, (err, employeeId) => {
    if (err) {
      res.status(500).send("Error creating employee");
    } else {
      res.status(201).send(`Created employee with ID ${employeeId}`);
    }
  });
});

/**
 * PUT update employee endpoint.
 *
 * @name PUT/api/employees/:id
 * @function
 * @memberof module:routes/employees
 * @inner
 * @param {object} req - The HTTP request object.
 * @param {object} res - The HTTP response object.
 * @returns {void}
 */
app.put("/employees/:id", (req, res) => {
  const employeeId = req.params.id;
  const employee = req.body;

  updateEmployee(employeeId, employee, (err) => {
    if (err) {
      res.status(500).send(`Error updating employee with ID ${employeeId}`);
    } else {
      res.send(`Updated employee with ID ${employeeId}`);
    }
  });
});

/**
 * DELETE employee endpoint.
 *
 * @name DELETE/api/employees/:id
 * @function
 * @memberof module:routes/employees
 * @inner
 * @param {object} req - The HTTP request object.
 * @param {object} res - The HTTP response object.
 * @returns {void}
 */
app.delete("/employees/:id", (req, res) => {
  const employeeId = req.params.id;

  deleteEmployee(employeeId, (err) => {
    if (err) {
      res.status(500).send(`Error deleting employee with ID ${employeeId}`);
    } else {
      res.send(`Deleted employee with ID ${employeeId}`);
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
