SET @dbname = 'nodesofyesod';

SET @query = CONCAT('CREATE DATABASE IF NOT EXISTS `', @dbname, '`');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @query = CONCAT('USE `', @dbname, '`');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- `score` drzi cas v sekundach: originalni panel zadne skore nema a zadna
-- bodovaci rutina se zatim nenasla (ZADANI.md par. 4), takze hall of fame
-- radi podle hodin, ktere panel originalu opravdu ma. Sloupec se jmenuje
-- `score` schvalne - je to totez API jako u sourozeneckych remaku.
CREATE TABLE IF NOT EXISTS rg_noy_hallOfFame (
  `ndx` BIGINT(20) NOT NULL AUTO_INCREMENT,
  `name` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `score` BIGINT(20) NOT NULL,
  `created` TIMESTAMP NOT NULL,
  PRIMARY KEY (`ndx`),
  INDEX `score` (`score`),
  INDEX `name` (`name`),
  INDEX `created` (`created`),
  INDEX `created_name` (`created`, `name`)
);
