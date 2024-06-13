# Specify the base image
FROM node:18-slim

# Set the working directory in the container to /app
WORKDIR /app

# Copy the package.json and package-lock.json to the working directory
COPY package*.json ./

# Copy src/app.js to the working directory
COPY src/app.js ./

# Install the dependencies in the container
RUN npm install

# Copy the rest of the code to the working directory
COPY . .

# Specify the command to run the app
CMD [ "node", "app.js" ]
