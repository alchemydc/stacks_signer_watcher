# stacks_signer_watcher
Monitor a Stacks signer and alert if it falls out of the elected set based on stake weight or other operational issues

# dependencies
nodejs 18.x or docker and docker-compose

# quick start
1) Copy the env-template to .env: `cp env-template .env`
2) Edit .env with discord webhook and signer public key(s)

## nodejs
1) Install dependencies: `npm install`
2) Start the app: `node app.js`

## docker
1) Build the image: `docker-compose build`
2) Start with docker-compose: `docker-compose up`

# Testing
Tests are a work in progress, and are incomplete at this point

