# Dependências em uma etapa separada: as ferramentas de compilação (bcrypt)
# não vão para a imagem final.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# pg_dump/pg_restore para o backup do banco (src/server/backup_db.js).
RUN apk add --no-cache postgresql17-client


COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# A aplicação não roda como administrador dentro do contêiner.
USER node

EXPOSE 4444
CMD ["npm", "start"]
